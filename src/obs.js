import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';

/**
 * OBS WebSocket v5 (obs-websocket 5.x) client for the two director superpowers:
 * capturing the live program frame (vision director) and saving the replay buffer.
 * Connections are short-lived and stateless — connect, identify, one request, close —
 * so a hung OBS costs one bounded attempt and never the stream.
 */

/** base64(SHA-256(password + salt + challenge)) per the obs-websocket auth spec. */
export function buildAuthentication(password, salt, challenge) {
  return createHash('sha256').update(`${password}${salt}${challenge}`).digest('base64');
}

export function createObs({ url, password = '', sourceName = '', timeoutMs = 1500, WebSocketImpl = WebSocket, log = () => {} }) {
  if (!url) {
    return { configured: false, captureFrame: async () => null, saveReplay: async () => false, close: () => {} };
  }
  /** One connect → identify → single-request session, bounded by one overall deadline. */
  const session = () => new Promise((resolve, reject) => {
    let socket;
    let settled = false;
    const expiresAt = Date.now() + timeoutMs;
    let deadline = setTimeout(() => finish(new Error('OBS timed out.')), timeoutMs);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) socket?.close();
      error ? reject(error) : resolve(value);
    };
    let requestId = 0;
    const pending = new Map();
    const failPending = (message) => {
      for (const { timer, rejectRequest } of pending.values()) { clearTimeout(timer); rejectRequest(new Error(message)); }
      pending.clear();
    };
    socket = new WebSocketImpl(url);
    socket.addEventListener('error', () => finish(new Error('OBS connection failed.')));
    socket.addEventListener('close', () => failPending('OBS connection closed.'));
    socket.addEventListener('message', (event) => {
      let frame;
      try { frame = JSON.parse(event.data); } catch { return; }
      if (frame.op === 0) {
        const auth = frame.d?.authentication;
        if (auth?.challenge && !password) { finish(new Error('OBS requires a password (set OBS_PASSWORD).')); return; }
        const identify = { op: 1, d: { rpcVersion: 1, eventSubscriptions: 0 } };
        if (auth?.challenge) identify.d.authentication = buildAuthentication(password, auth.salt, auth.challenge);
        socket.send(JSON.stringify(identify));
      } else if (frame.op === 2) {
        const request = (requestType, requestData = {}) => new Promise((resolveRequest, rejectRequest) => {
          const id = `dc-${++requestId}`;
          // Handshakes consume part of the budget; each request gets whatever is left.
          const timer = setTimeout(() => {
            pending.delete(id);
            rejectRequest(new Error(`OBS request '${requestType}' timed out.`));
          }, Math.max(50, expiresAt - Date.now()));
          pending.set(id, { resolveRequest, rejectRequest, timer });
          socket.send(JSON.stringify({ op: 6, d: { requestType, requestId: id, requestData } }));
        });
        finish(null, { request, close: () => socket.close() });
      } else if (frame.op === 9) {
        socket.send(JSON.stringify({ op: 10 }));
      } else if (frame.op === 7) {
        const waiting = pending.get(frame.d?.requestId);
        if (!waiting) return;
        pending.delete(frame.d.requestId);
        clearTimeout(waiting.timer);
        if (frame.d?.requestStatus?.result) waiting.resolveRequest(frame.d.responseData || {});
        else waiting.rejectRequest(new Error(`OBS request failed (${frame.d?.requestStatus?.code ?? 'unknown'}).`));
      }
    });
  });

  const programSource = async (request) => {
    if (sourceName) return sourceName;
    const scene = await request('GetCurrentProgramScene');
    return scene.currentProgramSceneName || '';
  };

  return {
    configured: true,
    /** A JPEG data URL of the live program (or the configured source), or null on any failure. */
    async captureFrame() {
      try {
        const { request, close } = await session();
        try {
          const source = await programSource(request);
          if (!source) throw new Error('No program scene.');
          const shot = await request('GetSourceScreenshot', { sourceName: source, imageFormat: 'jpg', quality: 55, imageWidth: 640 });
          return { imageData: shot.imageData, sourceName: shot.sourceName || source };
        } finally { close(); }
      } catch (error) {
        log(`  obs ▸ frame unavailable · ${error.message}`);
        return null;
      }
    },
    /** Saves the OBS replay buffer so the streamer keeps the clip; true only on success. */
    async saveReplay() {
      try {
        const { request, close } = await session();
        try { await request('SaveReplayBuffer'); return true; }
        finally { close(); }
      } catch (error) {
        log(`  obs ▸ replay not saved · ${error.message}`);
        return false;
      }
    },
    close: () => {},
  };
}

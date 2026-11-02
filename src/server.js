import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { checkCooldown } from './chat.js';
import { isStyle, STYLES } from './styles.js';

const publicDir = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const ROLES = new Set(['overlay', 'preview', 'control']);
const STYLE_LIST = Object.entries(STYLES).map(([key, { label, badge, description }]) => ({ key, label, badge, description }));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

/** One active generation/playback, at most two waiting requests. */
export function createSceneQueue({ direct, broadcast, cooldownSeconds, recentChat = () => [], onServed = () => {}, log = console.log }) {
  const pending = [];
  const waiters = [];
  let active = false;
  let closed = false;
  let timer;
  let lastFireTs = null;
  let take = 0;
  const settle = () => { if (!active && !pending.length) waiters.splice(0).forEach((resolve) => resolve()); };
  async function drain() {
    if (closed || active || !pending.length) { settle(); return; }
    active = true;
    const trigger = pending.shift();
    try {
      const scene = await direct(trigger, recentChat());
      if (closed) return;
      const id = randomUUID();
      broadcast({ type: 'cutscene', scene, id, take: ++take });
      onServed();
      log(`  rolling ▸ ${scene.style.toUpperCase()} · ${scene.credit.replace('EXECUTIVE PRODUCER: ', '')} · ${(scene.durationMs / 1000).toFixed(1)}s`);
      timer = setTimeout(() => {
        broadcast({ type: 'idle' });
        active = false;
        void drain();
      }, scene.durationMs);
    } catch {
      // The director handles LLM failures; keep the queue usable on unexpected errors too.
      log('  director ▸ scene interrupted');
      broadcast({ type: 'idle' });
      active = false;
      void drain();
    } finally {
      if (closed) { active = false; settle(); }
    }
  }
  return {
    trigger(trigger) {
      if (closed) return { accepted: false, reason: 'stopping', retryAfterMs: 1000 };
      const now = Date.now();
      if (active && trigger.source !== 'manual') return { accepted: false, reason: 'busy', retryAfterMs: 1000 };
      if (pending.length >= 2) {
        broadcast({ type: 'dropped' });
        return { accepted: false, reason: 'queue-full', retryAfterMs: 1000 };
      }
      if (!checkCooldown(lastFireTs, now, cooldownSeconds)) {
        return { accepted: false, reason: 'cooldown', retryAfterMs: Math.max(0, lastFireTs + cooldownSeconds * 1000 - now) };
      }
      lastFireTs = now;
      pending.push(trigger);
      void drain();
      return { accepted: true, cooldownMs: cooldownSeconds * 1000 };
    },
    whenIdle: () => !active && !pending.length ? Promise.resolve() : new Promise((resolve) => waiters.push(resolve)),
    stop() { closed = true; clearTimeout(timer); pending.length = 0; active = false; settle(); },
  };
}

async function readJSON(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw Object.assign(new Error('Request body too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Expected a JSON body.'), { status: 400 }); }
}

export function createServer({ config, onTrigger, obs = null, WebSocketServerImpl = WebSocketServer }) {
  const started = Date.now();
  let cutscenesServed = 0;
  const json = (response, status, value, headers = {}) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    response.end(JSON.stringify(value));
  };
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/healthz') {
        const roles = { overlay: 0, preview: 0, control: 0 };
        for (const client of wss.clients) roles[client.role] += 1;
        // wsClients counts real overlays only; console previews and monitors are reported separately.
        json(response, 200, { ok: true, channel: config.channel, model: config.llm.model, uptimeSec: Math.floor((Date.now() - started) / 1000), cutscenesServed, wsClients: roles.overlay, previewClients: roles.preview, rolling: Boolean(currentScene), obs: obs?.configured ? 'configured' : 'off' });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/trigger') {
        const body = await readJSON(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || (body.style !== undefined && !isStyle(body.style))
          || (body.user !== undefined && (typeof body.user !== 'string' || body.user.length > 100))) {
          json(response, 400, { error: 'Expected {style?, user?} with a known style and a string user.' });
          return;
        }
        const result = onTrigger({ style: body.style, user: body.user || 'operator', message: 'Operator requested a test cutscene.', source: 'manual' });
        json(response, result.accepted ? 202 : 429, result, result.accepted ? {} : { 'Retry-After': String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))) });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/replay') {
        // Saves the OBS replay buffer (the streamer keeps the clip) and cuts a slow-mo scene.
        if (!obs?.configured) { json(response, 503, { error: 'OBS is not configured (set OBS_URL).' }); return; }
        const saved = await obs.saveReplay();
        if (!saved) { json(response, 503, { error: 'OBS replay buffer unavailable.' }); return; }
        const result = onTrigger({ user: 'replay-director', style: 'baywatch', message: 'Replay buffer saved — cut the slow-mo.', source: 'manual' });
        json(response, result.accepted ? 202 : 429, { ...result, saved: true }, result.accepted ? {} : { 'Retry-After': String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))) });
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') { json(response, 405, { error: 'Method not allowed.' }); return; }
      const name = url.pathname === '/' ? 'index.html' : url.pathname === '/overlay' ? 'overlay.html' : url.pathname === '/control' ? 'control.html' : decodeURIComponent(url.pathname).replace(/^\//, '');
      const target = path.resolve(publicDir, name);
      if (!target.startsWith(`${publicDir}${path.sep}`) || !MIME[path.extname(target)]) { json(response, 404, { error: 'Not found.' }); return; }
      const content = await readFile(target);
      response.writeHead(200, { 'Content-Type': MIME[path.extname(target)], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) json(response, error.status || (error.code === 'ENOENT' ? 404 : error instanceof URIError ? 400 : 500), { error: error.status ? error.message : 'Request unavailable.' });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  const wss = new WebSocketServerImpl({ server, path: '/overlay', maxPayload: 4096 });
  // HTTP listen failures are reported by listen(); avoid a second unhandled emitter error.
  wss.on('error', () => {});
  // Late joiners (OBS browser-source reload, judge opening the overlay mid-scene)
  // get the live scene replayed with its remaining duration instead of a blank slate.
  let currentScene = null;
  let sceneStartedAt = 0;
  wss.on('connection', (socket, request) => {
    socket.on('error', () => {});
    const role = new URL(request.url, 'http://localhost').searchParams.get('role');
    socket.role = ROLES.has(role) ? role : 'overlay';
    socket.send(JSON.stringify({ type: 'hello', config: { channel: config.channel, model: config.llm.model }, styles: STYLE_LIST }));
    if (currentScene) {
      const elapsedMs = Date.now() - sceneStartedAt;
      const remaining = Math.max(2500, (currentScene.scene.durationMs || 8000) - elapsedMs);
      socket.send(JSON.stringify({ type: 'cutscene', scene: { ...currentScene.scene, durationMs: remaining, elapsedMs }, id: currentScene.id, take: currentScene.take, late: true }));
    }
  });
  return {
    broadcast(payload) {
      if (payload.type === 'cutscene') { currentScene = payload; sceneStartedAt = Date.now(); }
      // A dropped request never interrupts the active scene, so only idle clears it.
      if (payload.type === 'idle') currentScene = null;
      const data = JSON.stringify(payload);
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 1024 * 1024) client.send(data);
      }
    },
    onServed() { cutscenesServed += 1; },
    address: () => server.address(),
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    }),
    close: () => new Promise((resolve) => {
      for (const client of wss.clients) client.terminate();
      wss.close();
      server.close(resolve);
      server.closeIdleConnections();
    }),
  };
}

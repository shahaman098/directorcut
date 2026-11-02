import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthentication, createObs } from '../src/obs.js';

/** Scriptable stand-in for the client side of an OBS WebSocket session. */
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.listeners = {};
    this.closed = false;
    queueMicrotask(() => this.emit('open'));
  }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; this.emit('close'); }
  emit(type, event = {}) { for (const handler of this.listeners[type] || []) handler(event); }
  receive(payload) { this.emit('message', { data: JSON.stringify(payload) }); }
  /** Responds to the most recent client request. */
  reply(requestType, responseData = {}) {
    const sent = this.sent[this.sent.length - 1];
    assert.equal(sent.d.requestType, requestType);
    this.receive({ op: 7, d: { requestId: sent.d.requestId, requestStatus: { result: true, code: 0 }, responseData } });
  }
  static hello(auth) {
    return { op: 0, d: { rpcVersion: 1, ...(auth ? { authentication: auth } : {}) } };
  }
  static identify(socket) {
    return socket.sent[0];
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const DATA_URL = 'data:image/jpeg;base64,ZnJhbWU=';
const tracked = (sockets) => class extends MockWebSocket { constructor(url) { super(url); sockets.push(this); } };

test('authentication follows the obs-websocket sha256 spec', () => {
  assert.equal(buildAuthentication('s3cr3t', 'c2FsdA==', 'Y2hhbGxlbmdl'), 'uNx0sl9omjla6zYNF4Y5MBp1JydW1OPV1nzvI7h9R0E=');
});

test('captureFrame screenshots the current program scene and closes the session', async () => {
  const sockets = [];
  const obs = createObs({ url: 'ws://127.0.0.1:4455', timeoutMs: 500, WebSocketImpl: tracked(sockets) });
  const pending = obs.captureFrame();
  await tick();
  const socket = sockets[0];
  socket.receive(MockWebSocket.hello());
  socket.receive({ op: 2, d: {} });
  await tick(); // the client now asks for the program scene
  socket.reply('GetCurrentProgramScene', { currentProgramSceneName: 'Game Scene' });
  await tick(); // and then for the screenshot
  socket.reply('GetSourceScreenshot', { imageData: DATA_URL, sourceName: 'Game Scene' });
  assert.deepEqual(await pending, { imageData: DATA_URL, sourceName: 'Game Scene' });
  assert.deepEqual([MockWebSocket.identify(socket).op, MockWebSocket.identify(socket).d.rpcVersion], [1, 1]);
  assert.equal(socket.sent[1].d.requestType, 'GetCurrentProgramScene');
  assert.equal(socket.sent[2].d.requestData.sourceName, 'Game Scene');
  assert.equal(socket.closed, true);
});

test('an explicit source name skips the program-scene lookup', async () => {
  const sockets = [];
  const obs = createObs({ url: 'ws://127.0.0.1:4455', sourceName: 'Game Capture', timeoutMs: 500, WebSocketImpl: tracked(sockets) });
  const pending = obs.captureFrame();
  await tick();
  const socket = sockets[0];
  socket.receive(MockWebSocket.hello());
  socket.receive({ op: 2, d: {} });
  await tick();
  socket.reply('GetSourceScreenshot', { imageData: DATA_URL, sourceName: 'Game Capture' });
  assert.deepEqual(await pending, { imageData: DATA_URL, sourceName: 'Game Capture' });
  assert.equal(socket.sent[1].d.requestType, 'GetSourceScreenshot');
  assert.equal(socket.sent[1].d.requestData.sourceName, 'Game Capture');
});

test('secured OBS identifies with the derived challenge response', async () => {
  const sockets = [];
  const obs = createObs({ url: 'ws://127.0.0.1:4455', password: 's3cr3t', timeoutMs: 500, WebSocketImpl: tracked(sockets) });
  const pending = obs.captureFrame();
  await tick();
  const socket = sockets[0];
  socket.receive(MockWebSocket.hello({ salt: 'c2FsdA==', challenge: 'Y2hhbGxlbmdl' }));
  socket.receive({ op: 2, d: {} });
  await tick();
  socket.reply('GetCurrentProgramScene', { currentProgramSceneName: 'Scene' });
  await tick();
  socket.reply('GetSourceScreenshot', { imageData: DATA_URL, sourceName: 'Scene' });
  assert.equal((await pending).sourceName, 'Scene');
  assert.equal(MockWebSocket.identify(socket).d.authentication, 'uNx0sl9omjla6zYNF4Y5MBp1JydW1OPV1nzvI7h9R0E=');
});

test('a password challenge without OBS_PASSWORD fails fast instead of hanging', async () => {
  const sockets = [];
  const obs = createObs({ url: 'ws://127.0.0.1:4455', timeoutMs: 500, WebSocketImpl: tracked(sockets) });
  const pending = obs.captureFrame();
  await tick();
  sockets[0].receive(MockWebSocket.hello({ salt: 'salt', challenge: 'challenge' }));
  assert.equal(await pending, null);
  assert.equal(sockets[0].closed, true);
});

test('an unreachable OBS, a rejected request, and a closed connection all return null', async () => {
  const sockets = [];
  const obs = createObs({ url: 'ws://127.0.0.1:4455', timeoutMs: 500, WebSocketImpl: tracked(sockets) });
  const failing = obs.captureFrame();
  await tick();
  sockets[0].emit('error');
  assert.equal(await failing, null);

  const sockets2 = [];
  const obs2 = createObs({ url: 'ws://127.0.0.1:4455', timeoutMs: 500, WebSocketImpl: tracked(sockets2) });
  const rejected = obs2.captureFrame();
  await tick();
  const socket = sockets2[0];
  socket.receive(MockWebSocket.hello());
  socket.receive({ op: 2, d: {} });
  await tick();
  const sent = socket.sent[socket.sent.length - 1];
  socket.receive({ op: 7, d: { requestId: sent.d.requestId, requestStatus: { result: false, code: 600 }, responseData: {} } });
  assert.equal(await rejected, null);

  const sockets3 = [];
  const obs3 = createObs({ url: 'ws://127.0.0.1:4455', timeoutMs: 500, WebSocketImpl: tracked(sockets3) });
  const closing = obs3.captureFrame();
  await tick();
  const socket3 = sockets3[0];
  socket3.receive(MockWebSocket.hello());
  socket3.receive({ op: 2, d: {} });
  await tick();
  socket3.close();
  assert.equal(await closing, null);
});

test('a silent OBS and an unanswered request are both bounded by the deadline', async () => {
  const obs = createObs({ url: 'ws://127.0.0.1:4455', timeoutMs: 40, WebSocketImpl: MockWebSocket });
  const start = performance.now();
  assert.equal(await obs.captureFrame(), null);
  assert.equal(performance.now() - start < 1000, true);

  const sockets = [];
  const obs2 = createObs({ url: 'ws://127.0.0.1:4455', timeoutMs: 120, WebSocketImpl: tracked(sockets) });
  const start2 = performance.now();
  const pending = obs2.captureFrame();
  await tick();
  sockets[0].receive(MockWebSocket.hello());
  sockets[0].receive({ op: 2, d: {} });
  assert.equal(await pending, null);
  assert.equal(performance.now() - start2 < 1000, true);
});

test('saveReplay reports success and every failure mode as a boolean', async () => {
  assert.equal(await createObs({ url: '' }).saveReplay(), false);

  const sockets = [];
  const obs = createObs({ url: 'ws://127.0.0.1:4455', timeoutMs: 500, WebSocketImpl: tracked(sockets) });
  const pending = obs.saveReplay();
  await tick();
  const socket = sockets[0];
  socket.receive(MockWebSocket.hello());
  socket.receive({ op: 2, d: {} });
  await tick();
  socket.reply('SaveReplayBuffer');
  assert.deepEqual([await pending, socket.sent[1].d.requestType, socket.closed], [true, 'SaveReplayBuffer', true]);

  const sockets2 = [];
  const obs2 = createObs({ url: 'ws://127.0.0.1:4455', timeoutMs: 40, WebSocketImpl: tracked(sockets2) });
  assert.equal(await obs2.saveReplay(), false);
});

test('an unconfigured obs degrades to disabled no-ops', async () => {
  const obs = createObs({ url: '' });
  assert.deepEqual([obs.configured, await obs.captureFrame(), await obs.saveReplay()], [false, null, false]);
});

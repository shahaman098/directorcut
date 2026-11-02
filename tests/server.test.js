import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { createSceneQueue, createServer } from '../src/server.js';
import { fallbackScene } from '../src/director.js';

test('queue broadcasts increasing takes across scenes and drops do not consume a take', async (t) => {
  const payloads = [];
  const scene = { ...fallbackScene(), durationMs: 1 };
  const queue = createSceneQueue({ direct: async () => scene, broadcast: (payload) => payloads.push(payload), cooldownSeconds: 0, log: () => {} });
  t.after(() => queue.stop());
  assert.equal(queue.trigger({ source: 'chat' }).accepted, true);
  assert.equal(queue.trigger({ source: 'manual' }).accepted, true);
  assert.equal(queue.trigger({ source: 'manual' }).accepted, true);
  assert.equal(queue.trigger({ source: 'manual' }).reason, 'queue-full');
  await queue.whenIdle();
  assert.equal(queue.trigger({ source: 'chat' }).accepted, true);
  await queue.whenIdle();
  const cutscenes = payloads.filter(({ type }) => type === 'cutscene');
  assert.deepEqual(cutscenes.map(({ take }) => take), [1, 2, 3, 4]);
  assert.equal(cutscenes.some((payload) => 'pitch' in payload), false);
  assert.equal(new Set(cutscenes.map(({ id }) => id)).size, 4);
  assert.equal(cutscenes.every((payload) => payload.scene === scene), true);
  assert.equal(payloads.filter(({ type }) => type === 'dropped').length, 1);
});
test('live broadcasts and late-join replay carry the same server take without opening sockets', async (t) => {
  let wss;
  class WebSocketServerImpl extends EventEmitter {
    constructor() { super(); this.clients = new Set(); wss = this; }
    close() {}
  }
  const server = createServer({ config: { channel: 'test', llm: { model: 'test-model' } }, onTrigger: () => ({ accepted: true }), WebSocketServerImpl });
  t.after(() => server.close());
  const connect = () => {
    const messages = [];
    const socket = new EventEmitter();
    Object.assign(socket, { readyState: 1, bufferedAmount: 0, send: (data) => messages.push(JSON.parse(data)), terminate: () => {} });
    wss.clients.add(socket);
    wss.emit('connection', socket);
    return messages;
  };
  const first = connect();
  const scene = fallbackScene();
  const payload = { type: 'cutscene', scene, id: 'scene-37', take: 37 };
  server.broadcast(payload);
  assert.deepEqual([first.length, first[0].type, first[0].config.channel, first[1]], [2, 'hello', 'test', payload]);
  for (let i = 0; i < 2; i += 1) {
    const replay = connect()[1];
    assert.deepEqual([replay.type, replay.id, replay.take, replay.late, replay.scene.caption], ['cutscene', 'scene-37', 37, true, scene.caption]);
    assert.equal(replay.scene.durationMs >= 2500 && replay.scene.durationMs <= scene.durationMs, true);
  }
  server.broadcast({ ...payload, id: 'scene-38', take: 38 });
  assert.equal(connect()[1].take, 38);
  server.broadcast({ type: 'idle' });
  assert.deepEqual(connect().map(({ type }) => type), ['hello']);
});

const config = { channel: 'test_channel', port: 0, llm: { model: 'test-model' } };

function open(base, role) {
  const socket = new WebSocket(`${base.replace('http', 'ws')}/overlay${role ? `?role=${role}` : ''}`);
  const hello = new Promise((resolve, reject) => {
    socket.once('message', (data) => resolve(JSON.parse(data)));
    socket.once('error', reject);
  });
  return { socket, hello };
}

test('server tags socket roles, ships style metadata, and serves the console pages', async (t) => {
  const triggers = [];
  const server = createServer({ config, onTrigger: (trigger) => { triggers.push(trigger); return { accepted: true, cooldownMs: 0 }; } });
  await server.listen();
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const overlay = open(base);
  const preview = open(base, 'preview');
  const control = open(base, 'control');
  const hello = await overlay.hello;
  await Promise.all([preview.hello, control.hello]);
  assert.equal(hello.type, 'hello');
  assert.equal(hello.config.channel, 'test_channel');
  assert.deepEqual(hello.styles.map((style) => style.key), ['noir', 'anime', 'hollywood', 'baywatch', 'sportscast']);

  const health = await (await fetch(`${base}/healthz`)).json();
  assert.equal(health.wsClients, 1, 'previews and monitors are not counted as overlays');
  assert.equal(health.previewClients, 1);
  assert.equal(health.rolling, false);

  server.broadcast({ type: 'cutscene', id: 'abc', scene: { style: 'noir', durationMs: 8000 } });
  assert.equal((await (await fetch(`${base}/healthz`)).json()).rolling, true);
  server.broadcast({ type: 'dropped' });
  assert.equal((await (await fetch(`${base}/healthz`)).json()).rolling, true, 'a dropped request leaves the active scene rolling');
  server.broadcast({ type: 'idle' });
  assert.equal((await (await fetch(`${base}/healthz`)).json()).rolling, false);

  for (const page of ['/', '/control', '/overlay']) {
    const response = await fetch(base + page);
    assert.equal(response.status, 200, page);
    assert.match(response.headers.get('content-type'), /text\/html/);
  }

  const post = (body, headers = { 'Content-Type': 'application/json' }) => fetch(`${base}/api/trigger`, { method: 'POST', headers, body: JSON.stringify(body) });
  // A cross-site form or text/plain fetch cannot fire a scene: JSON is required.
  assert.equal((await post({ style: 'noir' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post({ style: 'western' })).status, 400);
  assert.equal((await post({ pitch: 42 })).status, 400);
  assert.equal((await post({ pitch: 'x'.repeat(301) })).status, 400);
  assert.equal(triggers.length, 0);
  assert.equal((await post({ style: 'anime', pitch: '  one hp clutch  ' })).status, 202);
  assert.deepEqual([triggers[0].pitch, triggers[0].message, triggers[0].source], ['one hp clutch', 'one hp clutch', 'manual']);

  for (const { socket } of [overlay, preview, control]) socket.close();
});

test('a viewer pitch rides with the broadcast for the console', async (t) => {
  const payloads = [];
  const queue = createSceneQueue({ direct: async () => ({ ...fallbackScene(), durationMs: 1 }), broadcast: (payload) => payloads.push(payload), cooldownSeconds: 0, log: () => {} });
  t.after(() => queue.stop());
  queue.trigger({ source: 'chat', pitch: 'swam the lake for a duck' });
  await queue.whenIdle();
  assert.equal(payloads.find(({ type }) => type === 'cutscene').pitch, 'swam the lake for a duck');
});

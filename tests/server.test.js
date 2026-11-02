import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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
  assert.deepEqual(first, [{ type: 'hello', config: { channel: 'test' } }, payload]);
  for (let i = 0; i < 2; i += 1) {
    const replay = connect()[1];
    assert.deepEqual([replay.type, replay.id, replay.take, replay.scene.caption], ['cutscene', 'scene-37', 37, scene.caption]);
    assert.equal(replay.scene.durationMs >= 2500 && replay.scene.durationMs <= scene.durationMs, true);
  }
  server.broadcast({ ...payload, id: 'scene-38', take: 38 });
  assert.equal(connect()[1].take, 38);
  server.broadcast({ type: 'idle' });
  assert.deepEqual(connect(), [{ type: 'hello', config: { channel: 'test' } }]);
});

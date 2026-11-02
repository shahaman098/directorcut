import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createServer } from '../src/server.js';

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

  const bad = await fetch(`${base}/api/trigger`, { method: 'POST', body: JSON.stringify({ style: 'western' }) });
  assert.equal(bad.status, 400);
  assert.equal(triggers.length, 0);

  for (const { socket } of [overlay, preview, control]) socket.close();
});

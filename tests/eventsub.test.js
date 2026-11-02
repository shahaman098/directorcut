import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldTriggerRedemption, refundRedemption, resolveBroadcasterId, createEventSub } from '../src/eventsub.js';

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.closed = false;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => this.emit('open'));
  }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  close() { this.closed = true; this.emit('close'); }
  emit(type, event = {}) { for (const handler of this.listeners[type] || []) handler(event); }
  receive(payload) { this.emit('message', { data: JSON.stringify(payload) }); }
}
MockWebSocket.instances = [];

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const twitch = { clientId: 'test-client', userToken: 'test-token', broadcasterId: '' };
const welcome = (id = 'session-1', keepalive = 300) => ({ type: 'session_welcome', payload: { session: { id, keepalive_timeout_seconds: keepalive } } });
const notification = (event) => ({ type: 'notification', payload: { subscription: { type: 'channel.channel_points_custom_reward_redemption.add' }, event } });
const redemption = (over = {}) => ({
  id: 'redemption-1', status: 'unfulfilled', user_name: 'Redeemer', user_login: 'redeemer', user_input: 'make it noir',
  reward: { id: 'reward-1', title: 'EXECUTIVE PRODUCER', cost: 500 }, ...over,
});

test('only unfulfilled redemptions trigger, filtered by the optional title allowlist', () => {
  assert.equal(shouldTriggerRedemption(redemption()), true);
  assert.deepEqual([
    shouldTriggerRedemption(redemption({ status: 'fulfilled' })),
    shouldTriggerRedemption(redemption({ status: 'canceled' })),
    shouldTriggerRedemption(null),
    shouldTriggerRedemption(redemption(), ['something else']),
    shouldTriggerRedemption(redemption(), ['executive producer']),
  ], [false, false, false, false, true]);
});

test('a welcome session creates the channel points subscription with the session id', async () => {
  const posts = [];
  MockWebSocket.instances = [];
  const fetchImpl = async (url, options) => {
    posts.push({ url, body: JSON.parse(options.body), headers: options.headers });
    return Response.json({ data: [{ id: 'sub-1' }] }, { status: 202 });
  };
  const sub = createEventSub({ twitch, broadcasterId: '1234', onTrigger: () => ({ accepted: true }), WebSocketImpl: MockWebSocket, fetchImpl, log: () => {} });
  sub.connect();
  await tick();
  MockWebSocket.instances[0].receive(welcome());
  await tick();
  assert.equal(posts.length, 1);
  assert.deepEqual([posts[0].url, posts[0].body.type, posts[0].body.condition.broadcaster_user_id, posts[0].body.transport.session_id],
    ['https://api.twitch.tv/helix/eventsub/subscriptions', 'channel.channel_points_custom_reward_redemption.add', '1234', 'session-1']);
  assert.deepEqual([posts[0].headers['Client-Id'], posts[0].headers.Authorization], ['test-client', 'Bearer test-token']);
  sub.close();
});

test('redemptions trigger paid manual cutscenes and rejected ones are refunded', async () => {
  MockWebSocket.instances = [];
  const patches = [];
  const triggers = [];
  const fetchImpl = async (url, options) => {
    if (options.method === 'PATCH') patches.push({ url, body: JSON.parse(options.body) });
    return Response.json({}, { status: 202 });
  };
  let verdict = { accepted: true };
  const sub = createEventSub({
    twitch, broadcasterId: '1234', onTrigger: (trigger) => { triggers.push(trigger); return verdict; },
    WebSocketImpl: MockWebSocket, fetchImpl, log: () => {},
  });
  sub.connect();
  await tick();
  const socket = MockWebSocket.instances[0];
  socket.receive(welcome());
  await tick();

  socket.receive(notification(redemption()));
  await tick();
  assert.deepEqual([triggers[0].user, triggers[0].source, triggers[0].message], ['Redeemer', 'manual', 'Channel points: EXECUTIVE PRODUCER — make it noir']);
  assert.deepEqual(triggers[0].redemption, { id: 'redemption-1', rewardId: 'reward-1', cost: 500 });
  assert.equal(patches.length, 0, 'accepted redemptions are never refunded');

  verdict = { accepted: false, reason: 'cooldown', retryAfterMs: 4000 };
  socket.receive(notification(redemption({ id: 'redemption-2' })));
  await tick();
  assert.equal(patches.length, 1);
  assert.match(patches[0].url, /id=redemption-2&broadcaster_id=1234$/);
  assert.deepEqual(patches[0].body, { status: 'CANCELED' });
  sub.close();
});

test('a reconnect notice reopens the socket on the Twitch-provided URL', async () => {
  MockWebSocket.instances = [];
  const sub = createEventSub({ twitch, broadcasterId: '1234', onTrigger: () => ({ accepted: true }), WebSocketImpl: MockWebSocket, fetchImpl: async () => Response.json({}, { status: 202 }), log: () => {}, reconnectMs: 5 });
  sub.connect();
  await tick();
  MockWebSocket.instances[0].receive({ type: 'session_reconnect', payload: { session: { reconnect_url: 'wss://reconnect.example/ws' } } });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual([MockWebSocket.instances[0].closed, MockWebSocket.instances[1].url], [true, 'wss://reconnect.example/ws']);
  sub.close();
});

test('an expired subscription request is logged, not fatal', async () => {
  MockWebSocket.instances = [];
  const logs = [];
  const sub = createEventSub({ twitch, broadcasterId: '1234', onTrigger: () => ({ accepted: true }), WebSocketImpl: MockWebSocket, fetchImpl: async () => Response.json({}, { status: 409 }), log: (line) => logs.push(line) });
  sub.connect();
  await tick();
  MockWebSocket.instances[0].receive(welcome());
  await tick();
  assert.equal(logs.some((line) => line.includes('HTTP 409')), true);
  sub.close();
});

test('refundRedemption reports failures as false and resolveBroadcasterId falls back to /users', async () => {
  const event = redemption();
  assert.equal(await refundRedemption(event, { broadcasterId: '1', clientId: 'c', userToken: 't' }, { fetchImpl: async () => { throw new Error('offline'); } }), false);

  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options.headers });
    return Response.json({ data: [{ id: '9876' }] });
  };
  assert.equal(await resolveBroadcasterId({ ...twitch, broadcasterId: 'preset' }, { fetchImpl }), 'preset');
  assert.equal(await resolveBroadcasterId(twitch, { fetchImpl }), '9876');
  assert.deepEqual([calls[0].url, calls[0].headers['Client-Id'], calls[0].headers.Authorization],
    ['https://api.twitch.tv/helix/users', 'test-client', 'Bearer test-token']);
});

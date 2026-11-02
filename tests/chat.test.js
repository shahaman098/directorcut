import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { checkCooldown, shouldTriggerOnHype, pruneHypeWindow, countHypeTokens, parseCommand, isAllowed, createChat } from '../src/chat.js';

test('cooldown blocks within the window and permits the exact boundary and first fire', () => {
  assert.deepEqual([checkCooldown(1000, 20999, 20), checkCooldown(1000, 21000, 20), checkCooldown(null, 0, 20)], [false, true, true]);
});
test('hype window excludes expired and future tokens', () => {
  const entries = [{ ts: 10000, count: 9 }, { ts: 10001, count: 2 }, { ts: 40000, count: 1 }, { ts: 40001, count: 9 }];
  assert.deepEqual(pruneHypeWindow(entries, 40000), [{ ts: 10001, count: 2 }, { ts: 40000, count: 1 }]);
});
test('hype threshold is inclusive, disabled at zero, and debounces for 60 seconds', () => {
  const entries = [{ ts: 100000, count: 3 }];
  assert.deepEqual([
    shouldTriggerOnHype(entries, 3, null, 100000), shouldTriggerOnHype(entries, 4, null, 100000),
    shouldTriggerOnHype(entries, 0, null, 100000), shouldTriggerOnHype(entries, 3, 40001, 100000),
    shouldTriggerOnHype(entries, 3, 40000, 100000),
  ], [true, false, false, false, true]);
});
test('hype tokens are whole words, counted per occurrence and case insensitive', () => {
  assert.equal(countHypeTokens('pog POGGERS! LUL W CLIP LETSGO EZ KEKW flower WW'), 8);
});
test('commands handle case, styles, custom commands, and excessive tokens', () => {
  assert.deepEqual([parseCommand('!CUTSCENE ANIME'), parseCommand('!cutscene unknown'), parseCommand('!cutsceneX'), parseCommand('!cutscene noir too many'), parseCommand('!cinema noir', '!cinema')], [{ style: 'anime' }, { style: undefined }, null, null, { style: 'noir' }]);
});
test('trigger role truth table includes missing tags, viewers, subscribers, VIPs, mods, and broadcaster', () => {
  const viewers = [undefined, {}, { subscriber: true }, { badges: { founder: '0' } }, { badges: { vip: '1' } }, { mod: true, badges: { moderator: '1' } }, { badges: { broadcaster: '1' } }];
  assert.deepEqual(['everyone', 'subs', 'vips', 'mods'].map((role) => viewers.map((tags) => isAllowed(tags, role))), [
    [true, true, true, true, true, true, true],
    [false, false, true, true, true, true, true],
    [false, false, false, false, true, true, true],
    [false, false, false, false, false, true, true],
  ]);
  assert.deepEqual([isAllowed({ mod: true }, 'subs'), isAllowed({ mod: true }, 'vips'), isAllowed({ badges: { mod: '1' } }, 'subs'), isAllowed({ badges: { moderator: '1' } }, 'vips')], [true, true, true, true]);
});

function fakeChat() {
  let client;
  const replies = [];
  class Client extends EventEmitter {
    constructor(options) { super(); this.options = options; client = this; }
    say(_channel, text) { replies.push(text); }
    connect() { this.emit('connected'); }
    disconnect() {}
  }
  const config = { channel: 'test', triggerCommand: '!cutscene', triggerRole: 'mods', cooldownSeconds: 20, hypeThreshold: 0, twitch: { username: 'bot', token: 'oauth:fake' }, llm: { model: 'test-model' } };
  return { Client, config, replies, message: (tags, text) => client.emit('message', '#test', tags, text, false) };
}

test('chat gates only commands, silently rejects viewers, and leaves hype unaffected', async () => {
  const fake = fakeChat();
  const triggers = [];
  const chat = await createChat({
    config: { ...fake.config, hypeThreshold: 1 }, Client: fake.Client, log: () => {},
    onTrigger: (trigger) => { triggers.push(trigger); return { accepted: true }; },
  });
  await chat.connect();
  fake.message(undefined, '!cutscene noir');
  fake.message({ username: 'viewer' }, '!cutscene noir');
  assert.deepEqual([triggers, fake.replies], [[], []]);
  fake.message({ username: 'mod', mod: true }, '!cutscene anime');
  fake.message({ username: 'viewer' }, '!cutscene sportscast POG');
  assert.deepEqual(triggers.map(({ user, style, source }) => ({ user, style, source })), [
    { user: 'mod', style: 'anime', source: 'chat' }, { user: 'CHAT ITSELF', style: 'sportscast', source: 'hype' },
  ]);
  assert.deepEqual(fake.replies, ['🎬 CUTSCENE INITIATED for @mod by test-model — rolling…']);
  await chat.disconnect();
});
test('quiet-modes from a viewer still suppresses busy replies under role gating', async () => {
  const fake = fakeChat();
  const chat = await createChat({ config: fake.config, Client: fake.Client, log: () => {}, onTrigger: () => ({ accepted: false, reason: 'busy' }) });
  await chat.connect();
  fake.message({ username: 'viewer' }, '!quiet-modes');
  fake.message({ username: 'mod', mod: true }, '!cutscene');
  assert.deepEqual(fake.replies, []);
  await chat.disconnect();
});
test('busy replies use the new wording and remain throttled once per cooldown window', async (t) => {
  const fake = fakeChat();
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const chat = await createChat({ config: fake.config, Client: fake.Client, log: () => {}, onTrigger: () => ({ accepted: false, reason: 'busy' }) });
  await chat.connect();
  const tags = { username: 'mod', mod: true };
  fake.message(tags, '!cutscene');
  now += 19999;
  fake.message(tags, '!cutscene');
  now += 1;
  fake.message(tags, '!cutscene');
  assert.deepEqual(fake.replies, [
    '🎬 a cutscene is already rolling, @mod — try again shortly',
    '🎬 a cutscene is already rolling, @mod — try again shortly',
  ]);
  await chat.disconnect();
});

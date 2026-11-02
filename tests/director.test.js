import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScene, validateScene, fallbackScene, createDirector } from '../src/director.js';
import { STYLES } from '../src/styles.js';

const trigger = { user: 'clip_enjoyer', style: 'noir', source: 'chat' };
const valid = { style: 'noir', durationMs: 8000, caption: 'The city held its breath.', subCaption: 'Chat knew.', badge: 'REPLAY', sting: 'horror', credit: 'EXECUTIVE PRODUCER: @clip_enjoyer' };

test('valid JSON passes through', () => {
  assert.deepEqual(parseScene(JSON.stringify(valid), trigger), valid);
});
test('fenced JSON is parsed', () => {
  assert.deepEqual(parseScene(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``, trigger), valid);
});
test('garbage and empty captions use a deterministic fallback', () => {
  assert.deepEqual([parseScene('not a script', trigger), parseScene('{"caption":"","subCaption":"x"}', trigger)], [fallbackScene(trigger), fallbackScene(trigger)]);
});
test('captions truncate and durations clamp', () => {
  const short = validateScene({ ...valid, caption: 'a'.repeat(120), subCaption: 'b'.repeat(100), durationMs: 1 }, trigger);
  const long = validateScene({ ...valid, durationMs: 99000 }, trigger);
  assert.deepEqual([short.caption.length, short.subCaption.length, short.durationMs, long.durationMs], [90, 60, 5000, 12000]);
});
test('unknown style and enums use the requested preset defaults', () => {
  const scene = validateScene({ ...valid, style: '__proto__', badge: 'WOW', sting: 'mp3' }, { ...trigger, style: 'anime' });
  assert.deepEqual([scene.style, scene.badge, scene.sting], ['anime', 'LEGENDARY', 'riser']);
});
test('credits are rebuilt for viewers and automatic hype', () => {
  assert.deepEqual([validateScene({ ...valid, credit: '@imposter' }, trigger).credit, validateScene(valid, { source: 'hype' }).credit], ['EXECUTIVE PRODUCER: @clip_enjoyer', 'EXECUTIVE PRODUCER: CHAT ITSELF']);
});
test('all five fallback treatments rotate, and provider failures still produce a scene', async () => {
  for (const style of Object.keys(STYLES)) {
    if (fallbackScene({ style }, 'test', 0).caption === fallbackScene({ style }, 'test', 1).caption) throw new Error(`${style} did not rotate`);
  }
  const director = createDirector({ llm: {}, channel: 'test', complete: async () => { throw new Error('offline'); } });
  assert.deepEqual(await director(trigger), fallbackScene(trigger, 'test', 0));
});
test('blocklisted captions and subcaptions use fallback before remote moderation', async () => {
  let calls = 0;
  const logs = [];
  for (const scene of [{ ...valid, caption: 'What the fuck!' }, { ...valid, subCaption: 'BULLSHIT!' }]) {
    const director = createDirector({
      llm: { baseUrl: 'https://api.openai.com/v1', apiKey: 'fake-test-key' }, channel: 'test',
      complete: async () => JSON.stringify(scene), log: (line) => logs.push(line),
      fetchImpl: async () => { calls += 1; throw new Error('Unexpected fetch'); },
    });
    assert.deepEqual(await director(trigger), fallbackScene(trigger, 'test', 0));
  }
  assert.deepEqual([calls, logs], [0, ['  director ▸ moderated · fallback', '  director ▸ moderated · fallback']]);
});
test('flagged or failed moderation uses the deterministic fallback and reports why', async () => {
  for (const fetchImpl of [
    async () => Response.json({ results: [{ flagged: true }] }),
    async () => { throw new Error('offline'); },
  ]) {
    const logs = [];
    let fallbacks = 0;
    const director = createDirector({
      llm: { baseUrl: 'https://api.openai.com/v1', apiKey: 'fake-test-key' }, channel: 'test',
      complete: async () => JSON.stringify(valid), fetchImpl, log: (line) => logs.push(line), onFallback: () => { fallbacks += 1; },
    });
    assert.deepEqual(await director(trigger), fallbackScene(trigger, 'test', 0));
    assert.equal(logs.includes('  director ▸ moderated · fallback'), true);
    assert.equal(logs.some((line) => /moderation (flagged|error)/.test(line)), true);
    assert.equal(fallbacks, 1);
  }
});
test('moderation off never fetches but still applies built-in and configured blocklists', async () => {
  let calls = 0;
  for (const [scene, blocklist, expected] of [
    [valid, undefined, valid],
    [{ ...valid, caption: 'fuck' }, undefined, fallbackScene(trigger, 'test', 0)],
    [{ ...valid, subCaption: 'Spoiler!' }, ['spoiler'], fallbackScene(trigger, 'test', 0)],
  ]) {
    const director = createDirector({
      llm: { baseUrl: 'https://api.openai.com/v1', apiKey: 'fake-test-key' }, channel: 'test', moderation: 'off', blocklist,
      complete: async () => JSON.stringify(scene), log: () => {},
      fetchImpl: async () => { calls += 1; throw new Error('Unexpected fetch'); },
    });
    assert.deepEqual(await director(trigger), expected);
  }
  assert.equal(calls, 0);
});
test('clean moderation and unavailable local moderation preserve validated scenes', async () => {
  for (const llm of [
    { baseUrl: 'https://api.openai.com/v1', apiKey: 'fake-test-key' },
    { baseUrl: 'http://local.invalid/v1', apiKey: '' },
  ]) {
    const director = createDirector({ llm, channel: 'test', complete: async () => JSON.stringify(valid), fetchImpl: async () => Response.json({ results: [{ flagged: false }] }) });
    assert.deepEqual(await director(trigger), valid);
  }
});
test('moderation shares the overall director deadline and aborts its request', async () => {
  let signal;
  let fallbacks = 0;
  const director = createDirector({
    llm: { baseUrl: 'https://api.openai.com/v1', apiKey: 'fake-test-key', timeoutMs: 30 }, channel: 'test',
    complete: async () => JSON.stringify(valid), log: () => {}, onFallback: () => { fallbacks += 1; },
    fetchImpl: (_url, options) => { signal = options.signal; return new Promise(() => {}); },
  });
  const start = performance.now();
  assert.deepEqual(await director(trigger), fallbackScene(trigger, 'test', 0));
  assert.equal(performance.now() - start < 1000, true);
  assert.deepEqual([signal.aborted, fallbacks], [true, 1]);
});
test('a stalled completion is bounded by the director deadline too', async () => {
  let signal;
  const director = createDirector({
    llm: { timeoutMs: 15 }, channel: 'test',
    complete: (_llm, _messages, options) => { signal = options.signal; return new Promise(() => {}); },
  });
  assert.deepEqual(await director(trigger), fallbackScene(trigger, 'test', 0));
  assert.equal(signal.aborted, true);
});
test('the vision director reacts to the captured frame when enabled', async () => {
  const frame = { imageData: 'data:image/jpeg;base64,ZnJhbWU=', sourceName: 'Game Scene' };
  let seen;
  const obs = { captureFrame: async () => frame };
  const director = createDirector({ llm: {}, channel: 'test', vision: 'on', obs, complete: (_llm, messages) => { seen = messages; return JSON.stringify(valid); } });
  assert.deepEqual(await director(trigger), valid);
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[seen.length - 1].content[1].image_url, { url: frame.imageData, detail: 'low' });
});
test('a missing frame or disabled vision degrades to the text-only director', async () => {
  let captures = 0;
  let seen;
  const obs = { captureFrame: async () => { captures += 1; return null; } };
  const director = createDirector({ llm: {}, channel: 'test', vision: 'on', obs, complete: (_llm, messages) => { seen = messages; return JSON.stringify(valid); } });
  assert.deepEqual(await director(trigger), valid);
  assert.deepEqual([captures, seen.length], [1, 2]);
  let capturesOff = 0;
  const directorOff = createDirector({ llm: {}, channel: 'test', vision: 'off', obs: { captureFrame: async () => { capturesOff += 1; return null; } }, complete: () => JSON.stringify(valid) });
  assert.deepEqual(await directorOff(trigger), valid);
  assert.equal(capturesOff, 0);
});

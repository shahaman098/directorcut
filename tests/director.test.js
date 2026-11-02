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

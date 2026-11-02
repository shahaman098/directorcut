import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCooldown, shouldTriggerOnHype, pruneHypeWindow, countHypeTokens, parseCommand } from '../src/chat.js';

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

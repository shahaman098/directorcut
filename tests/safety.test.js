import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { blocklistHit, loadBlocklist, moderate, cleanPitch, sanitizeTrigger, PITCH_MAX } from '../src/safety.js';

const llm = { baseUrl: 'https://api.openai.com/v1', apiKey: 'fake-test-key' };

test('blocklist matches whole words case insensitively and escapes custom terms', () => {
  assert.deepEqual([
    blocklistHit('What the FUCK!'), blocklistHit('A fucking replay.'), blocklistHit('Scunthorpe has a replay.'),
    blocklistHit('classical cinema'), blocklistHit('damn, what a play'), blocklistHit('unfuckable'),
    blocklistHit('A C++ replay.', ['c++']), blocklistHit('A ccc replay.', ['c++']),
    blocklistHit('éfucké'), blocklistHit('word', ['', '   ']),
  ], [true, true, false, false, false, false, true, false, false, false]);
});
test('loadBlocklist merges optional file terms once, ignores comments, and tolerates missing or empty files', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'directorcut-blocklist-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'terms.txt');
  writeFileSync(file, '# channel terms\r\n Spoiler \r\nspoiler\r\nplot twist # inline comment\r\n\r\n');
  const terms = loadBlocklist({ BLOCKLIST_FILE: file });
  writeFileSync(file, '');
  assert.deepEqual([
    terms.filter((term) => term === 'spoiler').length, blocklistHit('SPOILER!', terms),
    blocklistHit('plot twist.', terms), blocklistHit('fuck', terms), blocklistHit('comments', terms),
  ], [1, true, true, true, false]);
  assert.deepEqual(loadBlocklist({ BLOCKLIST_FILE: file }), loadBlocklist({}));
  assert.deepEqual(loadBlocklist({ BLOCKLIST_FILE: path.join(dir, 'missing') }), loadBlocklist({}));
});
test('moderation sends the expected request and accepts clean results', async () => {
  let request;
  const result = await moderate(['A replay.', 'Chat knew.'], { ...llm, baseUrl: `${llm.baseUrl}/` }, { fetchImpl: async (url, options) => {
    request = { url, method: options.method, auth: options.headers.Authorization, body: JSON.parse(options.body), signal: options.signal };
    return Response.json({ results: [{ flagged: false }, { flagged: false }] });
  } });
  assert.deepEqual(result, { flagged: false, reason: 'clean' });
  assert.deepEqual([request.url, request.method, request.auth, request.body, request.signal.aborted], [
    'https://api.openai.com/v1/moderations', 'POST', 'Bearer fake-test-key',
    { model: 'omni-moderation-latest', input: ['A replay.', 'Chat knew.'] }, false,
  ]);
});
test('any flagged moderation result flags the script', async () => {
  assert.deepEqual(await moderate(['caption', 'tagline'], llm, { fetchImpl: async () => Response.json({ results: [{ flagged: false }, { flagged: true }] }) }), { flagged: true, reason: 'flagged' });
});
test('moderation fails closed on fetch, HTTP, JSON, and malformed-result errors', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('offline'); },
    async () => new Response('Unavailable', { status: 503 }),
    async () => new Response('not JSON'),
    async () => Response.json({}),
    async () => Response.json({ results: [] }),
    async () => Response.json({ results: [{}] }),
  ]) {
    assert.deepEqual(await moderate(['caption'], llm, { fetchImpl }), { flagged: true, reason: 'error' });
  }
});
test('aborted moderation fails closed with the timeout reason', async () => {
  assert.deepEqual(await moderate(['caption'], llm, { fetchImpl: async () => { throw new DOMException('aborted', 'AbortError'); } }), { flagged: true, reason: 'timeout' });
});
test('moderation times out after 1500ms even if fetch ignores its abort signal', async () => {
  let signal;
  const result = await moderate(['caption'], llm, { fetchImpl: (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  } });
  assert.deepEqual([result, signal.aborted], [{ flagged: true, reason: 'timeout' }, true]);
});
test('non-OpenAI providers and empty keys skip fetch', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('Unexpected fetch'); };
  for (const provider of [{ ...llm, baseUrl: 'http://local.invalid/v1' }, { ...llm, apiKey: '' }]) {
    assert.deepEqual(await moderate(['caption'], provider, { fetchImpl }), { flagged: false, reason: 'unavailable' });
  }
  assert.equal(calls, 0);
});
test('built-in list blocks severe slurs as whole words without false positives', () => {
  const slur = Buffer.from('ZmFnZ290', 'base64').toString('utf8');
  assert.deepEqual([blocklistHit(`what a ${slur}`), blocklistHit(`${slur.toUpperCase()}!`), blocklistHit('drape the grapes'), blocklistHit('raccoon city'), blocklistHit('kill yourself, chat said', loadBlocklist({}))], [true, true, false, false, true]);
});

test('cleanPitch strips control characters, links and mentions, caps length, and rejects blocklisted text', () => {
  assert.equal(cleanPitch('one hp\u0000 clutch\u202e @mod https://x.example/a'), 'one hp clutch');
  assert.equal(cleanPitch('a'.repeat(500)).length, PITCH_MAX);
  assert.equal(cleanPitch('that was shit'), '');
  assert.deepEqual([cleanPitch(undefined), cleanPitch(42), cleanPitch('   ')], ['', '', '']);
});
test('sanitizeTrigger is idempotent and leaves pitch-less triggers untouched', () => {
  const plain = { user: 'a', message: '!cutscene' };
  assert.equal(sanitizeTrigger(plain), plain);
  const once = sanitizeTrigger({ user: 'a', pitch: ' duck rescue ', message: '!cutscene duck rescue' });
  assert.deepEqual(sanitizeTrigger(once), once);
  assert.deepEqual(sanitizeTrigger({ pitch: 'bullshit', message: '!cutscene bullshit' }), { pitch: undefined, message: '' });
});

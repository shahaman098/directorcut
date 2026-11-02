import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJSON, chatCompletion } from '../src/llm.js';

const llm = { baseUrl: 'http://local.invalid/v1', apiKey: '', model: 'local-director', timeoutMs: 500 };

test('extracts fenced and garbage-wrapped objects', () => {
  assert.deepEqual([extractJSON('```json\n{"caption":"Cut!"}\n```'), extractJSON('Here is the script: {"caption":"Cut!"} end.')], [{ caption: 'Cut!' }, { caption: 'Cut!' }]);
});
test('malformed or missing JSON throws', () => {
  assert.throws(() => extractJSON('{"caption": broken}'), SyntaxError);
  assert.throws(() => extractJSON('no object here'), /no JSON object/);
});
test('400 retries exactly once without response_format and omits empty authorization', async () => {
  const calls = [];
  const result = await chatCompletion(llm, [], { fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body), auth: options.headers.Authorization });
    return calls.length === 1 ? new Response('Unsupported response_format', { status: 400 }) : Response.json({ choices: [{ message: { content: '{"caption":"Action"}' } }] });
  } });
  assert.deepEqual([calls.length, calls[0].body.response_format, calls[1].body.response_format, calls[0].auth, calls[0].url, result], [2, { type: 'json_object' }, undefined, undefined, 'http://local.invalid/v1/chat/completions', '{"caption":"Action"}']);
});
test('non-empty API key sends a bearer header, and other HTTP errors throw without retry', async () => {
  let calls = 0;
  let auth;
  await assert.rejects(chatCompletion({ ...llm, apiKey: 'fake-test-key' }, [], { fetchImpl: async (_url, options) => {
    calls += 1; auth = options.headers.Authorization;
    return new Response('Unavailable', { status: 503 });
  } }), /HTTP 503/);
  assert.deepEqual([calls, auth], [1, 'Bearer fake-test-key']);
});
test('timeout aborts and throws so the caller can fall back', async () => {
  await assert.rejects(chatCompletion({ ...llm, timeoutMs: 15 }, [], { fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) }), /timed out/);
});

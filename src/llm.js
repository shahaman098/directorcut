/** Accept fenced JSON and prose around an object, but never evaluate model output. */
export function extractJSON(text) {
  if (typeof text !== 'string') throw new Error('Director response is not text.');
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');
  if (first < 0 || last < first) throw new Error('Director response has no JSON object.');
  const parsed = JSON.parse(clean.slice(first, last + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Director response must be an object.');
  return parsed;
}

export async function chatCompletion(llm, messages, { fetchImpl = globalThis.fetch, signal } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(() => controller.abort(), llm.timeoutMs);
  const headers = { 'Content-Type': 'application/json' };
  if (llm.apiKey) headers.Authorization = `Bearer ${llm.apiKey}`;
  const body = { model: llm.model, messages, temperature: 0.9, max_tokens: 300 };
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetchImpl(`${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', headers, signal: controller.signal,
        body: JSON.stringify(attempt === 0 ? { ...body, response_format: { type: 'json_object' } } : body),
      });
      if (!response.ok) {
        // Some compatible endpoints reject structured output with a bare 400.
        const detail = await response.text();
        if (attempt === 0 && (response.status === 400 || /response_format|json_object/i.test(detail))) continue;
        throw new Error(`Director endpoint returned HTTP ${response.status}.`);
      }
      const result = await response.json();
      const content = result?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('Director endpoint returned no message.');
      return content;
    }
    throw new Error('Director endpoint rejected the request.');
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Director timed out after ${llm.timeoutMs}ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

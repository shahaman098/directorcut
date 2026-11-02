import { readFileSync } from 'node:fs';

// Severe slurs and self-harm phrases, base64-encoded so they aren't plain text in the
// source. These are what get a Twitch channel actioned; the profanity below is stylistic.
const SLURS = JSON.parse(Buffer.from('WyJuaWdnZXIiLCJuaWdnYSIsImZhZ2dvdCIsImZhZyIsInJldGFyZCIsInJldGFyZGVkIiwidHJhbm55Iiwia2lrZSIsImNoaW5rIiwic3BpYyIsIndldGJhY2siLCJnb29rIiwiY29vbiIsImt5cyIsImtpbGwgeW91cnNlbGYiLCJraWxsIHVyc2VsZiIsInJhcGUiLCJyYXBlZCIsInJhcGlzdCIsImhlaWwgaGl0bGVyIiwic2llZyBoZWlsIl0=', 'base64').toString('utf8'));
const BUILT_INS = Object.freeze(['fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bullshit', 'cunt', 'cocksucker', 'dickhead', 'asshole', ...SLURS]);

const LINKS = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|tv|gg|io|ly|xyz|link)\b\S*/gi;

/** Strip links and @mentions from untrusted chat before it reaches the model. */
export const scrub = (text) => String(text).replace(LINKS, '').replace(/@\w+/g, '').replace(/\s{2,}/g, ' ').trim();

export const PITCH_MAX = 100;

/**
 * A viewer's one-line "what just happened" pitch. Untrusted: links, @mentions and control
 * characters are stripped, length is capped, and any blocklisted term drops the whole pitch.
 * Only moderated model output ever reaches the overlay; the pitch itself is never rendered.
 */
export function cleanPitch(text, terms = BUILT_INS) {
  if (typeof text !== 'string') return '';
  const pitch = scrub(text.replace(/[\p{Cc}\p{Cf}]/gu, ' ')).slice(0, PITCH_MAX).trim();
  return pitch && !blocklistHit(pitch, terms) ? pitch : '';
}

/** Clean a trigger's pitch; a rejected pitch also blanks the chat message that carried it. Idempotent. */
export function sanitizeTrigger(trigger, terms = BUILT_INS) {
  if (!trigger || trigger.pitch === undefined) return trigger;
  const pitch = cleanPitch(trigger.pitch, terms);
  return pitch ? { ...trigger, pitch } : { ...trigger, pitch: undefined, message: '' };
}

export function loadBlocklist(env = {}) {
  let extra = '';
  if (env.BLOCKLIST_FILE) {
    try { extra = readFileSync(env.BLOCKLIST_FILE, 'utf8'); } catch { /* An optional blocklist may be absent. */ }
  }
  return [...new Set([...BUILT_INS, ...extra.split(/\r?\n/).map((line) => line.split('#')[0].trim())]
    .map((term) => term.toLowerCase()).filter(Boolean))];
}

export function blocklistHit(text, terms = BUILT_INS) {
  return terms.some((term) => {
    if (typeof term !== 'string' || !term.trim()) return false;
    const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(String(text));
  });
}

export async function moderate(texts, llm, { fetchImpl = globalThis.fetch, log = () => {}, signal } = {}) {
  if (!llm.baseUrl?.includes('api.openai.com') || !llm.apiKey) return { flagged: false, reason: 'unavailable' };
  const controller = new AbortController();
  const abort = () => controller.abort();
  let onAbort;
  const aborted = new Promise((resolve) => {
    onAbort = () => resolve({ flagged: true, reason: 'timeout' });
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 1500);
  try {
    const request = async () => {
      if (controller.signal.aborted) return { flagged: true, reason: 'timeout' };
      const response = await fetchImpl(`${llm.baseUrl.replace(/\/+$/, '')}/moderations`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
        body: JSON.stringify({ model: 'omni-moderation-latest', input: texts }),
      });
      if (!response.ok) throw new Error('Moderation endpoint unavailable.');
      const body = await response.json();
      if (!Array.isArray(body?.results) || !body.results.length
        || body.results.some((result) => typeof result?.flagged !== 'boolean')) throw new Error('Invalid moderation results.');
      const flagged = body.results.some((result) => result.flagged);
      return { flagged, reason: flagged ? 'flagged' : 'clean' };
    };
    const result = await Promise.race([request(), aborted]);
    if (result.flagged) log(`  safety ▸ moderation ${result.reason}`);
    return result;
  } catch (error) {
    const reason = controller.signal.aborted || error?.name === 'AbortError' ? 'timeout' : 'error';
    log(`  safety ▸ moderation ${reason}`);
    return { flagged: true, reason };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

import 'dotenv/config';
import { loadBlocklist } from './safety.js';

function integer(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

const baseUrl = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
let endpoint;
try { endpoint = new URL(baseUrl); } catch { throw new Error('LLM_BASE_URL must be a valid HTTP(S) URL.'); }
if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('LLM_BASE_URL must use HTTP(S).');
const channel = (process.env.TWITCH_CHANNEL || '').trim().replace(/^#/, '').toLowerCase();
if (channel && !/^[a-z0-9_]{1,25}$/.test(channel)) throw new Error('TWITCH_CHANNEL must be a Twitch channel name.');
const token = (process.env.TWITCH_OAUTH_TOKEN || '').trim();
const username = (process.env.TWITCH_BOT_USERNAME || '').trim().toLowerCase();
if (token && !/^[a-z0-9_]{1,25}$/.test(username)) throw new Error('Set TWITCH_BOT_USERNAME when using TWITCH_OAUTH_TOKEN.');
const command = (process.env.TRIGGER_COMMAND || '!cutscene').trim().toLowerCase();
if (!/^!\S+$/.test(command)) throw new Error('TRIGGER_COMMAND must be one word starting with !.');
// Optional OBS WebSocket: a malformed URL silently disables the vision director and
// replay trigger (they are enhancements); startup logs make the disabled state visible.
const obsUrlRaw = (process.env.OBS_URL || '').trim();
const vision = (process.env.DIRECTOR_VISION || 'off').trim().toLowerCase();
if (!['on', 'off'].includes(vision)) throw new Error('DIRECTOR_VISION must be on or off.');

export const config = {
  channel,
  port: integer('PORT', 3000, 1, 65535),
  triggerCommand: command,
  triggerRole: ['everyone', 'subs', 'vips', 'mods'].includes(process.env.TRIGGER_ROLE) ? process.env.TRIGGER_ROLE : 'everyone',
  moderation: ['auto', 'off'].includes(process.env.MODERATION) ? process.env.MODERATION : 'auto',
  blocklist: loadBlocklist(process.env),
  cooldownSeconds: integer('COOLDOWN_SECONDS', 20, 0, 3600),
  hypeThreshold: integer('HYPE_THRESHOLD', 0, 0, 100000),
  vision,
  obs: {
    url: /^wss?:\/\//.test(obsUrlRaw) ? obsUrlRaw : '',
    password: process.env.OBS_PASSWORD || '',
    sourceName: (process.env.OBS_SOURCE_NAME || '').trim(),
    timeoutMs: integer('OBS_TIMEOUT_MS', 1500, 200, 10000),
  },
  twitch: {
    username,
    token: token ? (token.startsWith('oauth:') ? token : `oauth:${token}`) : '',
    clientId: (process.env.TWITCH_CLIENT_ID || '').trim(),
    userToken: (process.env.TWITCH_USER_TOKEN || '').trim(),
    broadcasterId: (process.env.TWITCH_BROADCASTER_ID || '').trim(),
  },
  rewardTitles: (process.env.REWARD_TITLES || '').split(',').map((title) => title.trim().toLowerCase()).filter(Boolean),
  llm: {
    baseUrl,
    apiKey: (process.env.LLM_API_KEY || '').trim(),
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    timeoutMs: integer('LLM_TIMEOUT_MS', 4000, 1, 120000),
  },
};

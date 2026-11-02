import { isStyle } from './styles.js';
import { PITCH_MAX } from './safety.js';

const HYPE = new Set(['LUL', 'POG', 'POGGERS', 'KEKW', 'W', 'CLIP', 'LETSGO', 'EZ']);
export const checkCooldown = (lastFireTs, now, cooldownSec) => lastFireTs == null || now - lastFireTs >= cooldownSec * 1000;
export const pruneHypeWindow = (entries, now) => entries.filter(({ ts }) => ts > now - 30000 && ts <= now);
export const countHypeTokens = (message) => (String(message).toUpperCase().match(/[A-Z0-9_]+/g) || [])
  .reduce((sum, word) => sum + Number(HYPE.has(word)), 0);

export function isAllowed(tags, role) {
  if (role === 'everyone') return true;
  if (!tags) return false;
  const badges = tags.badges || {};
  if (badges.broadcaster) return true;
  if (role === 'mods') return Boolean(tags.mod);
  if (role === 'vips') return Boolean(badges.vip || badges.mod || badges.moderator || tags.mod);
  if (role === 'subs') return Boolean(tags.subscriber || badges.founder || badges.vip || badges.mod || badges.moderator || tags.mod);
  return false;
}

export function shouldTriggerOnHype(windowCounts, threshold, lastAutoTs, now) {
  return threshold > 0 && (lastAutoTs == null || now - lastAutoTs >= 60000)
    && pruneHypeWindow(windowCounts, now).reduce((sum, entry) => sum + entry.count, 0) >= threshold;
}

/** `!cutscene [style] [pitch…]` — everything after the optional style is the viewer's pitch. */
export function parseCommand(message, command = '!cutscene') {
  const tokens = String(message).trim().split(/\s+/);
  if (tokens[0].toLowerCase() !== command.toLowerCase()) return null;
  const rest = tokens.slice(1);
  const style = isStyle(rest[0]?.toLowerCase()) ? rest.shift().toLowerCase() : undefined;
  const pitch = rest.join(' ').slice(0, PITCH_MAX).trim();
  return pitch ? { style, pitch } : { style };
}

export async function createChat({ config, onTrigger, onMessage = () => {}, log = console.log, Client }) {
  // Pure helpers and rehearsal never load Twitch's legacy networking dependencies.
  const TmiClient = Client || (await import('tmi.js')).default.Client;
  const authenticated = Boolean(config.twitch.token);
  const silent = () => {};
  const options = {
    options: { debug: false, skipUpdatingEmotesets: true },
    connection: { reconnect: true, secure: true }, channels: [config.channel],
    logger: { trace: silent, debug: silent, info: silent, warn: silent, error: silent, fatal: silent },
  };
  if (authenticated) options.identity = { username: config.twitch.username, password: config.twitch.token };
  const client = new TmiClient(options);
  let counts = [];
  let lastAutoTs = null;
  let lastBusyReplyTs = null;
  let quietUntil = 0;
  let connected = false;
  const say = async (text) => {
    if (!authenticated || !connected) return;
    try { await client.say(config.channel, text); } catch { log('  chat ▸ reply unavailable'); }
  };
  client.on('connected', () => { connected = true; log(`  chat ▸ #${config.channel} connected${authenticated ? '' : ' · anonymous'}`); });
  client.on('disconnected', () => { if (connected) log('  chat ▸ disconnected · reconnecting'); connected = false; });
  client.on('message', (_channel, tags, message, self) => {
    if (self) return;
    const now = Date.now();
    const user = tags?.username || 'viewer';
    onMessage(`${user}: ${message}`);
    const quiet = message.trim().toLowerCase() === '!quiet-modes';
    if (quiet) quietUntil = now + Math.max(1, config.cooldownSeconds) * 1000;
    counts = pruneHypeWindow(counts, now);
    const count = countHypeTokens(message);
    if (count) counts.push({ ts: now, count });
    const command = parseCommand(message, config.triggerCommand);
    if (command && isAllowed(tags, config.triggerRole || 'everyone')) {
      const result = onTrigger({ user, message, style: command.style, pitch: command.pitch, source: 'chat' });
      if (result.accepted) {
        void say(`🎬 CUTSCENE INITIATED for @${user} by ${config.llm.model} — rolling…`);
      } else if (result.reason === 'busy' && now >= quietUntil
        && checkCooldown(lastBusyReplyTs, now, Math.max(1, config.cooldownSeconds))) {
        lastBusyReplyTs = now;
        void say(`🎬 a cutscene is already rolling, @${user} — try again shortly`);
      }
    }
    if (shouldTriggerOnHype(counts, config.hypeThreshold, lastAutoTs, now)) {
      const result = onTrigger({ user: 'CHAT ITSELF', message, style: 'sportscast', source: 'hype' });
      if (result.accepted) { lastAutoTs = now; counts = []; }
    }
  });
  return {
    say,
    connect: () => client.connect(),
    disconnect: async () => {
      client.reconnect = false;
      try { await client.disconnect(); } catch { /* Already disconnected. */ }
    },
  };
}

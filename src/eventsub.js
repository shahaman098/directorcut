import { WebSocket } from 'ws';

/**
 * Channel Points → cutscenes via Twitch EventSub (WebSocket transport).
 * A redemption is treated like a paid manual trigger: it queues instead of getting
 * busy-rejected, and any redemption the queue cannot honor is refunded via Helix
 * so a viewer never loses points to a cooldown. Disabled unless both a Client ID
 * and a broadcaster user token are configured.
 */

/** Only unfulfilled redemptions trigger; an optional title allowlist narrows the scope. */
export function shouldTriggerRedemption(event, rewardTitles = []) {
  if (!event || event.status !== 'unfulfilled') return false;
  if (!rewardTitles.length) return true;
  return rewardTitles.includes(String(event.reward?.title || '').trim().toLowerCase());
}

/** Canceled redemptions refund automatically per Twitch policy; the API call just marks them. */
export async function refundRedemption(event, { broadcasterId, clientId, userToken }, { fetchImpl = globalThis.fetch, log = () => {} } = {}) {
  try {
    const query = `id=${encodeURIComponent(event.id)}&broadcaster_id=${encodeURIComponent(broadcasterId)}`;
    const response = await fetchImpl(`https://api.twitch.tv/helix/channel_points/custom_rewards_redemptions?${query}`, {
      method: 'PATCH',
      headers: { 'Client-Id': clientId, Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'CANCELED' }),
    });
    return response.ok;
  } catch (error) {
    log(`  eventsub ▸ refund failed · ${error.message}`);
    return false;
  }
}

/** Broadcaster ID from a user token when TWITCH_BROADCASTER_ID is not set; '' when unresolvable. */
export async function resolveBroadcasterId(twitch, { fetchImpl = globalThis.fetch, log = () => {} } = {}) {
  if (twitch.broadcasterId) return twitch.broadcasterId;
  try {
    const response = await fetchImpl('https://api.twitch.tv/helix/users', {
      headers: { 'Client-Id': twitch.clientId, Authorization: `Bearer ${twitch.userToken}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const id = (await response.json())?.data?.[0]?.id;
    if (!id) throw new Error('empty user list');
    return id;
  } catch (error) {
    log(`  eventsub ▸ could not resolve broadcaster id · ${error.message}`);
    return '';
  }
}

export function createEventSub({ twitch, broadcasterId, rewardTitles = [], onTrigger, WebSocketImpl = WebSocket, fetchImpl = globalThis.fetch, log = console.log, reconnectMs = 1000 }) {
  let socket;
  let closed = false;
  let retry = 0;
  let keepaliveTimer;
  let reconnectTimer;
  const URL_BASE = 'wss://eventsub.wss.twitch.tv/ws';

  const armKeepalive = (seconds) => {
    clearTimeout(keepaliveTimer);
    keepaliveTimer = setTimeout(() => { log('  eventsub ▸ keepalive expired · reconnecting'); socket?.close(); }, Math.max(10000, seconds * 1000 * 2));
  };

  async function subscribe(sessionId) {
    const response = await fetchImpl('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST',
      headers: { 'Client-Id': twitch.clientId, Authorization: `Bearer ${twitch.userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'channel.channel_points_custom_reward_redemption.add',
        version: '1',
        condition: { broadcaster_user_id: broadcasterId },
        transport: { method: 'websocket', session_id: sessionId },
      }),
    });
    if (!response.ok) throw new Error(`subscription rejected (HTTP ${response.status})`);
  }

  function handleNotification(payload) {
    if (payload?.subscription?.type !== 'channel.channel_points_custom_reward_redemption.add') return;
    const event = payload.event;
    if (!shouldTriggerRedemption(event, rewardTitles)) return;
    const user = String(event.user_name || event.user_login || 'redeemer');
    const input = String(event.user_input || '').slice(0, 300);
    const message = `Channel points: ${event.reward?.title || 'redemption'}${input ? ` — ${input}` : ''}`;
    const result = onTrigger({ user, message, source: 'manual', redemption: { id: event.id, rewardId: event.reward?.id, cost: event.reward?.cost } });
    if (!result.accepted) {
      log(`  eventsub ▸ refunded @${user} · ${result.reason}`);
      void refundRedemption(event, { broadcasterId, clientId: twitch.clientId, userToken: twitch.userToken }, { fetchImpl, log });
    }
  }

  function open(url = URL_BASE) {
    if (closed) return;
    socket = new WebSocketImpl(url);
    socket.addEventListener('message', (event) => {
      let frame;
      try { frame = JSON.parse(event.data); } catch { return; }
      if (frame.type === 'session_welcome') {
        retry = 0;
        const session = frame.payload?.session || {};
        armKeepalive(session.keepalive_timeout_seconds || 300);
        subscribe(session.id).then(
          () => log(`  eventsub ▸ channel points armed for ${broadcasterId}`),
          (error) => log(`  eventsub ▸ ${error.message}`),
        );
      } else if (frame.type === 'session_keepalive') {
        armKeepalive(300);
      } else if (frame.type === 'notification') {
        armKeepalive(300);
        try { handleNotification(frame.payload); } catch (error) { log(`  eventsub ▸ notification error · ${error.message}`); }
      } else if (frame.type === 'session_reconnect') {
        const next = frame.payload?.session?.reconnect_url;
        // Arm the directed reconnect before closing so the close listener does not double-schedule.
        reconnectTimer = setTimeout(() => open(next), reconnectMs);
        socket.close();
      } else if (frame.type === 'revocation') {
        log('  eventsub ▸ subscription revoked by Twitch');
      }
    });
    socket.addEventListener('error', () => socket.close());
    socket.addEventListener('close', () => {
      clearTimeout(keepaliveTimer);
      // A Twitch-directed reconnect (session_reconnect) already scheduled the next socket.
      if (!closed && !reconnectTimer) reconnectTimer = setTimeout(() => open(), Math.min(30000, reconnectMs * 2 ** retry++));
    });
  }

  return {
    connect: () => open(),
    close: () => { closed = true; clearTimeout(keepaliveTimer); clearTimeout(reconnectTimer); socket?.close(); },
  };
}

import { config as loadedConfig } from './config.js';
import { createDirector } from './director.js';
import { createChat } from './chat.js';
import { createServer, createSceneQueue } from './server.js';
import { startSimulation } from './simulate.js';

const flags = new Set(process.argv.slice(2));
if ([...flags].some((flag) => !['--simulate', '--once'].includes(flag)) || (flags.has('--once') && !flags.has('--simulate'))) {
  console.error('Usage: node src/index.js [--simulate [--once]]');
  process.exitCode = 1;
} else {
  const simulate = flags.has('--simulate');
  const config = { ...loadedConfig, channel: loadedConfig.channel || (simulate ? 'directorcut_rehearsal' : ''), cooldownSeconds: simulate ? 0 : loadedConfig.cooldownSeconds };
  if (!config.channel) {
    console.error('Set TWITCH_CHANNEL in .env, or rehearse with --simulate.');
    process.exitCode = 1;
  } else {
    const history = [];
    const onMessage = (text) => { history.push(text.slice(0, 500)); if (history.length > 20) history.shift(); };
    const direct = createDirector({ llm: config.llm, channel: config.channel, moderation: config.moderation, blocklist: config.blocklist, onFallback: () => console.log('  director ▸ local screenplay · fallback ready') });
    let queue;
    const onTrigger = (trigger) => queue.trigger(trigger);
    const server = createServer({ config, onTrigger });
    queue = createSceneQueue({ direct, broadcast: server.broadcast, cooldownSeconds: config.cooldownSeconds, recentChat: () => history.slice(), onServed: server.onServed });
    let chat;
    let stopSimulation;
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      stopSimulation?.();
      queue.stop();
      await Promise.all([chat?.disconnect(), server.close()]);
    };
    process.once('SIGINT', () => { void shutdown(); });
    process.once('SIGTERM', () => { void shutdown(); });
    try {
      await server.listen();
      console.log(`\n  DIRECTORCUT ▸ #${config.channel} ▸ ${config.llm.model}\n  ${simulate ? 'REHEARSAL' : 'LIVE'} ▸ http://localhost:${config.port}/overlay\n  CONTROL ▸ http://localhost:${config.port}/control\n`);
      if (simulate) {
        stopSimulation = startSimulation({ onTrigger, whenIdle: queue.whenIdle, onMessage, once: flags.has('--once') });
        if (flags.has('--once')) { await queue.whenIdle(); await shutdown(); }
      } else {
        chat = await createChat({ config, onTrigger, onMessage });
        try { await chat.connect(); }
        catch { console.error('  chat ▸ connection unavailable; operator console remains live'); }
      }
    } catch {
      console.error(`  server ▸ could not start on port ${config.port}`);
      process.exitCode = 1;
      await shutdown();
    }
  }
}

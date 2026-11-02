const SCENARIOS = [
  { user: 'clip_enjoyer', style: 'noir', source: 'chat', pitch: 'he missed all six shots and blamed the wind', lines: ['clip_enjoyer: !cutscene noir he missed all six shots and blamed the wind', 'lurker_7: that missed shot has a backstory'] },
  { user: 'power_arc', style: 'anime', source: 'chat', pitch: 'one hp clutch with a frying pan', lines: ['power_arc: !cutscene anime one hp clutch with a frying pan', 'combo_kid: POG POGGERS LETSGO', 'chat_senpai: THIS IS THE TRAINING ARC'] },
  { user: 'trailer_voice', style: 'hollywood', source: 'chat', lines: ['trailer_voice: !cutscene hollywood', 'popcorn_main: in a world where nobody reloads…'] },
  { user: 'beach_episode', style: 'baywatch', source: 'chat', pitch: 'swam the whole lake to rescue a duck', lines: ['beach_episode: !cutscene baywatch swam the whole lake to rescue a duck', 'sunset_squad: save the run, save the world'] },
  { user: 'CHAT ITSELF', style: 'sportscast', source: 'hype', lines: ['crowd_1: W W POG', 'crowd_2: CLIP LETSGO EZ', 'crowd_3: KEKW POGGERS LUL'] },
];

export function startSimulation({ onTrigger, whenIdle = () => Promise.resolve(), onMessage = () => {}, once = false, log = console.log }) {
  let index = 0;
  let stopped = false;
  let timer;
  const fire = () => {
    if (stopped) return;
    const started = Date.now();
    const scenario = SCENARIOS[index++ % SCENARIOS.length];
    for (const line of scenario.lines) { log(`  [simchat] ${line}`); onMessage(line); }
    onTrigger({ user: scenario.user, style: scenario.style, source: scenario.source, pitch: scenario.pitch, message: scenario.lines.join(' | ') });
    if (!once) void whenIdle().then(() => {
      if (!stopped) timer = setTimeout(fire, Math.max(0, 14000 - (Date.now() - started)));
    });
  };
  fire();
  return () => { stopped = true; clearTimeout(timer); };
}

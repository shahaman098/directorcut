(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const root = $('scene');
  const params = new URLSearchParams(location.search);
  const debug = params.get('debug') === '1';
  // The operator console embeds a muted preview; OBS loads the plain URL and stays an "overlay".
  const preview = params.has('preview');
  const role = ['overlay', 'preview', 'control'].includes(params.get('role')) ? params.get('role') : (preview ? 'preview' : 'overlay');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const STYLE_KEYS = new Set(['noir', 'anime', 'hollywood', 'baywatch', 'sportscast']);
  let socket;
  let retry = 0;
  let reconnectTimer;
  let timers = [];
  let grainFrame;
  let entranceFrame;
  let progressAnimation;
  let sceneStart = 0;
  let sceneVersion = 0;
  let sceneNumber = 0;
  let lastId = '—';
  let connection = 'connecting';
  let latency = '—';
  let audio;
  let currentSting;
  let audioCleanup = () => {};
  let unloading = false;
  const schedule = (callback, delay) => { timers.push(setTimeout(callback, delay)); };
  const updateDebug = () => {
    $('debug').hidden = !debug;
    $('debug').textContent = `WS ${connection} · scene ${lastId} · latency ${latency}`;
  };
  function hideScene() {
    sceneVersion += 1;
    timers.forEach(clearTimeout);
    timers = [];
    cancelAnimationFrame(grainFrame);
    cancelAnimationFrame(entranceFrame);
    progressAnimation?.cancel();
    progressAnimation = null;
    audioCleanup();
    root.hidden = true;
    root.className = '';
    currentSting = null;
    $('audio-unlock').hidden = true;
  }

  const pad = (value) => String(value).padStart(2, '0');
  // One rAF loop drives the film grain and the SMPTE-style timecode (24 fps frames).
  function animateFrame() {
    const canvas = $('grain');
    const ctx = reducedMotion ? null : canvas.getContext('2d', { alpha: false });
    const frame = ctx?.createImageData(canvas.width, canvas.height);
    const timecode = $('timecode');
    let previous = 0;
    const draw = (now) => {
      if (root.hidden) return;
      const elapsed = Math.max(0, Date.now() - sceneStart);
      const seconds = Math.floor(elapsed / 1000);
      const code = `00:${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}:${pad(Math.floor((elapsed % 1000) / 1000 * 24))}`;
      if (timecode.textContent !== code) timecode.textContent = code;
      if (ctx && now - previous > 80) {
        for (let i = 0; i < frame.data.length; i += 4) {
          const v = Math.random() * 255;
          frame.data[i] = v; frame.data[i + 1] = v; frame.data[i + 2] = v; frame.data[i + 3] = 255;
        }
        ctx.putImageData(frame, 0, 0);
        previous = now;
      }
      grainFrame = requestAnimationFrame(draw);
    };
    grainFrame = requestAnimationFrame(draw);
  }

  function getAudio() {
    if (!audio) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return null;
      audio = new Audio();
    }
    return audio;
  }

  function synthesize(sting) {
    const ctx = getAudio();
    if (!ctx || ctx.state !== 'running') return false;
    audioCleanup();
    const now = ctx.currentTime;
    const length = 1.95;
    const nodes = [];
    const sources = [];
    const node = (value) => { nodes.push(value); return value; };
    const master = node(ctx.createGain());
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(.28, now + .13);
    master.gain.setValueAtTime(.17, now + 1.25);
    master.gain.exponentialRampToValueAtTime(.0001, now + length);
    master.connect(ctx.destination);
    const oscillator = (frequency, type, start = 0, duration = length, detune = 0, destination = master) => {
      const osc = node(ctx.createOscillator());
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, now + start);
      osc.detune.value = detune;
      osc.connect(destination);
      osc.start(now + start);
      osc.stop(now + Math.min(length, start + duration));
      sources.push(osc);
      return osc;
    };
    const noise = (start, duration, destination) => {
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      const source = node(ctx.createBufferSource());
      source.buffer = buffer;
      source.connect(destination);
      source.start(now + start);
      source.stop(now + start + duration);
      sources.push(source);
    };
    const thud = (start) => {
      const gain = node(ctx.createGain());
      gain.gain.setValueAtTime(.8, now + start);
      gain.gain.exponentialRampToValueAtTime(.0001, now + start + .32);
      gain.connect(master);
      const osc = oscillator(100, 'sine', start, .35, 0, gain);
      osc.frequency.exponentialRampToValueAtTime(32, now + start + .3);
      const filter = node(ctx.createBiquadFilter());
      filter.type = 'lowpass'; filter.frequency.value = 230;
      filter.connect(gain);
      noise(start, .3, filter);
    };
    if (sting === 'brass') {
      const filter = node(ctx.createBiquadFilter());
      filter.type = 'lowpass'; filter.Q.value = .6;
      filter.frequency.setValueAtTime(180, now);
      filter.frequency.exponentialRampToValueAtTime(2100, now + .8);
      filter.frequency.exponentialRampToValueAtTime(350, now + length);
      filter.connect(master);
      [110, 164.81, 220].forEach((f) => oscillator(f, 'sawtooth', 0, length, 0, filter));
    } else if (sting === 'horror') {
      const tremolo = node(ctx.createGain()); tremolo.gain.value = .42; tremolo.connect(master);
      const modulation = node(ctx.createGain()); modulation.gain.value = .25; modulation.connect(tremolo.gain);
      oscillator(3.5, 'sine', 0, length, 0, modulation);
      [55, 58.27, 82.41].forEach((f, i) => oscillator(f, 'triangle', 0, length, i * 9 - 9, tremolo));
    } else if (sting === 'heroic') {
      [220, 277.18, 329.63, 440].forEach((f, i) => {
        const gain = node(ctx.createGain()); const start = i * .14;
        gain.gain.setValueAtTime(.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(.5, now + start + .025);
        gain.gain.exponentialRampToValueAtTime(.0001, now + 1.8);
        gain.connect(master); oscillator(f, 'triangle', start, 1.8 - start, 0, gain);
      });
      thud(.05);
    } else {
      const filter = node(ctx.createBiquadFilter()); filter.type = 'bandpass'; filter.Q.value = 4;
      filter.frequency.setValueAtTime(100, now);
      filter.frequency.exponentialRampToValueAtTime(6000, now + 1.5);
      filter.connect(master); noise(0, 1.55, filter); thud(1.55);
    }
    let cleanupTimer;
    audioCleanup = () => {
      clearTimeout(cleanupTimer);
      for (const source of sources) { try { source.stop(); } catch { /* Source already ended. */ } }
      for (const item of nodes) item.disconnect();
      audioCleanup = () => {};
    };
    cleanupTimer = setTimeout(() => audioCleanup(), 2200);
    return true;
  }

  function playSting(sting) {
    currentSting = sting;
    if (preview) return;
    try {
      const ctx = getAudio();
      if (!ctx) return;
      if (ctx.state !== 'running') { $('audio-unlock').hidden = preview; return; }
      synthesize(sting);
    } catch { /* Visual playback must always continue without audio. */ }
  }
  $('audio-unlock').addEventListener('click', async () => {
    try {
      const ctx = getAudio();
      if (!ctx) return;
      await ctx.resume();
      if (ctx.state !== 'running') return;
      if (currentSting && !root.hidden) synthesize(currentSting);
      $('audio-unlock').classList.add('fading');
      schedule(() => { $('audio-unlock').hidden = true; }, 300);
    } catch { /* The button remains available if the browser blocks audio. */ }
  });

  function renderScene(scene, id, take) {
    if (!scene || !STYLE_KEYS.has(scene.style) || typeof scene.caption !== 'string') return;
    hideScene();
    lastId = String(id || 'unknown').slice(0, 8);
    // The server's take survives OBS source reloads; older payloads fall back to a local count.
    sceneNumber = Number.isInteger(take) && take > 0 ? take : sceneNumber + 1;
    root.className = scene.style;
    $('badge').textContent = scene.badge;
    $('style-label').textContent = scene.style.toUpperCase();
    // Words are built as separate nodes (textContent only) and revealed with a staggered fade, trailer-title style.
    const caption = $('caption');
    const words = scene.caption.slice(0, 90).split(/\s+/).filter(Boolean);
    caption.className = Array.from(scene.caption).length > 55 ? 'long' : '';
    caption.setAttribute('aria-label', scene.caption);
    caption.replaceChildren(...words.flatMap((word, index) => {
      const span = Object.assign(document.createElement('span'), { className: 'w', textContent: word });
      span.setAttribute('aria-hidden', 'true');
      span.style.transitionDelay = `${index * 70}ms`;
      return index ? [document.createTextNode(' '), span] : [span];
    }));
    $('sub-caption').textContent = scene.subCaption;
    const split = String(scene.credit).indexOf(':');
    $('credit-role').textContent = split > 0 ? scene.credit.slice(0, split).trim() : 'EXECUTIVE PRODUCER';
    $('credit-name').textContent = split > 0 ? scene.credit.slice(split + 1).trim() : scene.credit;
    $('take').textContent = String(sceneNumber).padStart(3, '0');
    $('score-take').textContent = String(sceneNumber).padStart(2, '0');
    $('audio-unlock').classList.remove('fading');
    updateDebug();
    root.hidden = false;
    const version = sceneVersion;
    // Two frames give the initial off-screen bar positions a paint before entry.
    entranceFrame = requestAnimationFrame(() => { entranceFrame = requestAnimationFrame(() => {
      if (root.hidden || version !== sceneVersion) return;
      const duration = Math.min(12000, Math.max(2500, Number(scene.durationMs) || 8000));
      // Late joiners receive the remaining duration; elapsedMs keeps their timecode honest.
      sceneStart = Date.now() - Math.max(0, Number(scene.elapsedMs) || 0);
      root.classList.add('active');
      animateFrame();
      playSting(scene.sting);
      // Web Animations API so the time-remaining cue still runs under reduced motion (it is informational, not decorative).
      progressAnimation = $('progress').animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration, easing: 'linear', fill: 'forwards' });
      schedule(() => root.classList.add('styled'), 200);
      schedule(() => caption.classList.add('in'), 600);
      schedule(() => root.classList.add('exiting'), duration - 800);
      schedule(hideScene, duration);
    }); });
  }

  function connect() {
    connection = 'connecting'; updateDebug();
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/overlay?role=${role}`);
    socket.addEventListener('open', () => { connection = 'live'; retry = 0; updateDebug(); });
    socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'hello') $('channel').textContent = `#${payload.config.channel.toUpperCase()}`;
        if (payload.type === 'cutscene') renderScene(payload.scene, payload.id, payload.take);
        if (payload.type === 'idle') hideScene();
      } catch { /* Ignore malformed frames; reconnect remains available. */ }
    });
    socket.addEventListener('error', () => socket.close());
    socket.addEventListener('close', () => {
      connection = 'offline'; updateDebug();
      if (!unloading) reconnectTimer = setTimeout(connect, Math.min(5000, 300 * 2 ** retry++));
    });
  }
  // Same-origin round-trip latency is useful without changing the WS contract.
  async function measureLatency() {
    const start = performance.now();
    try {
      const response = await fetch('/healthz', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      latency = response.ok ? `${Math.round(performance.now() - start)}ms RTT` : '—';
    } catch { latency = '—'; }
    updateDebug();
  }
  const latencyTimer = debug ? setInterval(measureLatency, 5000) : null;
  if (debug) void measureLatency();
  window.addEventListener('pagehide', () => {
    unloading = true; clearTimeout(reconnectTimer); clearInterval(latencyTimer); hideScene(); socket?.close();
    if (audio) void audio.close();
  });
  connect();
})();

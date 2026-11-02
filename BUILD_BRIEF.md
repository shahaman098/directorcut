# DirectorCut — Build Brief

**Product:** Chat-triggered AI cutscene engine for Twitch streams. A viewer types `!cutscene` in chat → an "AI director" (LLM) generates a cinematic script (JSON) → a dramatic cutscene overlay renders live over the stream in OBS (letterbox bars, film filter, typewriter narration, producer credit, synthesized sting) → auto-exits.

**Context:** Submission for the Codex x TwitchCon hackathon. Judges score 25% each: Innovation, Potential Impact, Technological Implementation, Design ("easy to use and fun to watch"). The overlay IS the product — make it look like a broadcast graphics package, not a demo.

**Hard constraints:**
- Plain Node.js ESM JavaScript (Node >= 20). NO TypeScript, NO build step. Run with `node`.
- Dependencies allowed: `tmi.js`, `ws`, `dotenv`. Nothing else. Use native `fetch`, `WebSocket` not needed server-side (use `ws` lib for the WS server).
- No API keys in the repo. All secrets via `.env` (dotenv). Ship `.env.example`.
- All audio must be synthesized with WebAudio (oscillators/noise) — NO copyrighted audio files, NO external assets, NO CDN fonts/urls. Everything must work fully offline except the LLM call and Twitch IRC.
- One process serves: static overlay page, WebSocket (`/overlay`), health endpoint, and connects to Twitch chat.

## File layout

```
directorcut/
├── package.json          # type:module, name directorcut, scripts: start / simulate / test
├── .env.example
├── .gitignore            # node_modules, .env
├── BUILD_BRIEF.md
├── README.md
├── src/
│   ├── index.js          # entry: parses --simulate, boots server + chat + director queue
│   ├── config.js         # dotenv load + validation + exported config object
│   ├── llm.js            # OpenAI-compatible chat completions client (base-url pluggable)
│   ├── director.js       # prompt build, JSON parse (tolerant), validate, fallback template
│   ├── styles.js         # style presets data (noir/anime/hollywood/baywatch/sportscast)
│   ├── chat.js           # tmi.js client: trigger command, cooldown, hype auto-trigger
│   ├── server.js         # http static server + ws (/overlay) + /healthz + /api/trigger
│   └── simulate.js       # fake chat event generator for rehearsal
├── public/
│   ├── overlay.html      # THE hero artifact — see detailed spec below
│   ├── overlay.js        # ws client + cutscene renderer + WebAudio synth
│   └── control.html      # tiny operator page: status + manual trigger button
└── tests/
    ├── director.test.js  # json parsing (code fences), validation, fallback
    ├── chat.test.js      # cooldown + hype window counter logic
    └── llm.test.js       # tolerant JSON extraction from malformed/ responses
```

## Runtime LLM (provider-pluggable, OpenAI-compatible)

- `config.llm = { baseUrl, apiKey, model, timeoutMs }` from env:
  - `LLM_BASE_URL` (default `https://api.openai.com/v1`)
  - `LLM_API_KEY` (may be empty → then Ollama mode, no auth header)
  - `LLM_MODEL` (default `gpt-4o-mini`)
  - `LLM_TIMEOUT_MS` (default 8000)
- `POST {baseUrl}/chat/completions` with `{ model, messages, temperature: 0.9, max_tokens: 300, response_format: { type: 'json_object' } }`. If the endpoint errors on `response_format` (Ollama ignores it, some reject it), retry ONCE without it. Send `Authorization: Bearer` only when apiKey is non-empty.
- Parse defensively: strip markdown fences, find first `{`…last `}`, `JSON.parse`, validate shape → on any failure use the deterministic fallback.

## Cutscene script JSON (the LLM contract)

```json
{
  "style": "noir | anime | hollywood | baywatch | sportscast",
  "durationMs": 8000,
  "caption": "max 90 chars, dramatic narration about the streamer's moment",
  "subCaption": "max 60 chars, witty tagline",
  "badge": "REPLAY | BREAKING | SLOW-MO | LEGENDARY",
  "sting": "brass | horror | heroic | riser",
  "credit": "EXECUTIVE PRODUCER: @username"
}
```

Validation: caption/subCaption non-empty strings (truncate if long), style must be a known preset else fallback style, durationMs clamped 5000–12000, badge/sting in enum else preset default. `credit` always rebuilt server-side as `EXECUTIVE PRODUCER: @<triggering user>` (never trust LLM with usernames).

**Fallback template** (deterministic, rotates by counter — must be genuinely funny/cinematic, this is the no-API safety net):
e.g. noir: caption "The city held its breath. So did {channel}." subCaption "Some moments demand justice." anime: caption "THIS POWER… WAS FORGED IN CHAT ITSELF!" etc. One set per style, 2 variants each.

## Director system prompt (src/director.js)

"You are the AI director cutting live dramatic replays for the Twitch channel '{channel}'. A viewer typed '!cutscene'. Recent chat hype: {recentChat}. Write a punchy cutscene script as JSON only. The caption must feel like a movie trailer narrator reacting to the streamer's moment — bold, funny, zero filler, no emojis inside the JSON keys, plain ASCII quotes." Include the triggering message and the requested style if provided.

## Chat logic (src/chat.js)

- tmi.js client: `options.identity` ONLY if `TWITCH_OAUTH_TOKEN` is set (username = `TWITCH_BOT_USERNAME`); otherwise connect anonymously (read-only mode). channels: [`TWITCH_CHANNEL`].
- Trigger: message starting with `!cutscene` (case-insensitive; configurable `TRIGGER_COMMAND`). Optional second token = style preset name (validate). Ignore messages longer than 3 tokens.
- Cooldown: `COOLDOWN_SECONDS` (default 20). While busy (rendering) → if a `!cutscene` arrives, and `!quiet-modes` hasn't been sent recently, the bot (when it has identity) says: `🎬 cutscene already rolling — queue is full, @user` at most once per cooldown window. When idle-started fine → bot says `🎬 CUTSCENE INITIATED for @{user} by {llmModel} — rolling…` (only with identity).
- Hype auto-trigger (env-gated, `HYPE_THRESHOLD`, default 0 = disabled): rolling 30s window counts hype tokens (`LUL POG POGGERS KEKW W CLIP LETSGO EZ`), when count ≥ threshold fire a cutscene with style `sportscast`, credit `EXECUTIVE PRODUCER: CHAT ITSELF`. Debounce: one auto-trigger per 60s.
- Expose a callback interface: `onTrigger({user, message, style, source})` and `say(text)`.
- MUST be unit-testable without network: export pure helpers `shouldTriggerOnHype(windowCounts, threshold, lastAutoTs, now)` and `checkCooldown(lastFireTs, now, cooldownSec)`.

## Server (src/server.js)

- `PORT` (default 3000). Routes:
  - `GET /` → tiny landing page (name, status, links to /overlay and /control) — plain HTML string.
  - `GET /overlay` → serve public/overlay.html. `/overlay.js` etc. from public/ with correct content-types.
  - `GET /healthz` → JSON `{ok, channel, model, uptimeSec, cutscenesServed, wsClients}`.
  - `POST /api/trigger` → body `{style?, user?}` → same pipeline as chat (used by control page + tests). Returns 202 or 429 on cooldown.
- WS server on same http server, path `/overlay`: on connect send `{type:'hello', config:{channel}}`. Broadcast `cutscene` payloads `{type:'cutscene', scene, id}` and `{type:'idle'}`. Keep a max-2 queue; drop with `{type:'dropped'}` when a 3rd arrives during a cutscene.
- Graceful: LLM timeout → fallback template (never leave chat without a cutscene).

## Overlay (public/overlay.html + overlay.js) — THE DESIGN PIECE

Design language: broadcast/television graphics, high contrast, cinematic. 1920×1080 reference, but responsive. Transparent body background. No external assets: system font stacks only (`Georgia, 'Times New Roman', serif` for cinematic captions; `'Arial Black', Impact, sans-serif` for badges), inline SVG for speedlines/grain.

Cutscene sequence (when `cutscene` msg received):
1. **t=0:** letterbox bars (top+bottom, 12vh) slide in (300ms cubic-bezier); white flash frame (80ms); vignette layer fades in; film-grain canvas overlay (animated noise, subtle, 8% opacity).
2. **t=0.2s:** style layer applies: per-style tint overlay (`mix-blend-mode: multiply/overlay`) + preset class on root: `noir` (grayscale-ish duotone tint, high contrast), `anime` (magenta/cyan speedlines SVG + italic bold), `hollywood` (gold/warm + light leak radial), `baywatch` (warm orange + soft focus vignette), `sportscast` (blue lower-third + scoreboard chip). Radial speed-lines SVG rotates slowly during the scene.
3. **t=0.4s:** badge chip top-left: `● REPLAY` (red dot blinks 1s interval), style label next to it (`NOIR / DIR. AI`).
4. **t=0.6s:** caption typewriter-reveals center-low (above bottom bar), 40ms/char, cinematic serif, large (7vw), text-shadow. subCaption fades in under it (2.2vw, letterspaced uppercase, muted color).
5. **t=1.2s:** credit bottom-right inside bottom bar: `EXECUTIVE PRODUCER: @user` with ✦ decorations, gold, fades/slides in.
6. **Sting:** WebAudio synthesized per `sting` enum — `brass` (sawtooth chord swell A2-E3-A3 with lowpass sweep), `horror` (detuned low cluster + slow tremolo), `heroic` (major triad arpeggio + timpani-ish noise burst), `riser` (noise + resonant filter sweep up + impact thud at end). Master gain envelope, ~1.5–2s, graceful failure if AudioContext blocked.
7. **t=durationMs-800ms:** exit animation: caption fades, bars slide out, tint dissolves. Then send nothing (server broadcasts `idle`).

Other requirements:
- WS auto-reconnect (exponential backoff, cap 5s). `?debug=1` shows a small status chip (ws state, last scene id, latency).
- Audio unlock: if `AudioContext` is suspended (normal Chrome), show a tiny corner button "🔊 enable sting" (fades after click). In OBS it auto-plays (note in README).
- NOTHING visible on screen when idle (perfectly transparent — this runs over gameplay all stream).
- The idle state must render zero pixels: body background transparent, all layers `display:none` when idle.

## Simulate mode (src/simulate.js)

`node src/index.js --simulate`: skip Twitch connection; loop scripted scenarios every ~14s: noir trigger from user "clip_enjoyer", anime with hype burst, hollywood, baywatch, sportscast auto-trigger — each with plausible fake chat messages logged to console as `[simchat]`. Also allow `--simulate --once` for tests. Console output must look great (clean banner: DIRECTORCUT ▸ channel ▸ model ▸ overlay URL).

## Control page (public/control.html)

Minimal operator console: connection dot, healthz poll (channel, model, cutscenes served), big "🎬 TRIGGER TEST CUTSCENE" button (style dropdown), cooldown countdown. Dark, tasteful.

## Tests (node:test, no network, no tmi connect)

- director: valid JSON passthrough; fenced ```json block parsed; garbage → fallback; caption truncation; unknown style → preset default; credit override enforced.
- chat: cooldown blocks within window, allows after; hype counter window math (in/out of window, threshold edge).
- llm: extracts JSON from fenced/garbage-wrapped text; retry-without-response_format on 400; timeout → throw (caller falls back).
- Aim: 12–20 assertions total, all fast (<2s).

## README.md skeleton (write it)

Name + one-liner, "why" paragraph (streamers lose the magic of big moments; DirectorCut turns chat hype into instant cinema), 60-second setup (git clone, npm install, cp .env.example .env, set channel/token/key, npm start, add OBS browser source `http://localhost:3000/overlay` 1920×1080), commands table, how-it-works ASCII diagram (Twitch IRC → DirectorCut (LLM director) → OBS overlay), style presets table, "Built with OpenAI Codex" section (session id placeholder `CODEX_SESSION_ID_HERE`), hackathon submission notes, license MIT.

## Quality bar

- The overlay must look like something a Twitch creative director would nod at. Animations buttery (transform/opacity only, will-change on animated layers).
- No TODOs left in code. No console spam (concise, pretty logs).
- Every file compiles/runs on Node 20+ with zero warnings from `node --test`.

# DirectorCut

**Chat-triggered instant cinema for Twitch.** A viewer types `!cutscene`, an AI director writes a miniature movie trailer, and a cinematic overlay takes over the stream — complete with letterbox bars, narration, producer credit, and a synthesized sting.

Streamers lose the magic of big moments in the scroll of chat. DirectorCut turns that hype into instant cinema and gives viewers a part in the production. The person who calls the cutscene gets the executive producer credit, live on stream.

## 60-second setup

Requires Node.js **20 or newer**. No build step.

```sh
git clone https://github.com/shahaman098/directorcut.git
cd directorcut
npm install
cp .env.example .env
```

Edit `.env`: set `TWITCH_CHANNEL` to the channel name without `#`. Set `LLM_API_KEY` for OpenAI, or configure a local compatible provider. Optionally set both `TWITCH_BOT_USERNAME` and `TWITCH_OAUTH_TOKEN` to enable bot replies. Leave the bot credentials blank to read chat anonymously.

```sh
npm start
```

In OBS, add a **Browser Source** with URL `http://localhost:3000/overlay`, width **1920**, height **1080**. Keep the background transparent. Enable **Control audio via OBS** to mix the sting, and keep the source loaded while idle. The overlay occupies zero visible pixels between scenes. OBS Browser Sources normally allow autoplay; if your browser blocks WebAudio, interact with the source and click the **🔊 Click to enable sound** button during a scene. In a regular browser, that click may be required once per page load.

Open `http://localhost:3000/control`, choose a treatment (or press `1`–`5`), and press **🎬 TRIGGER TEST CUTSCENE** (or `Enter`). The console embeds a muted, true-scale preview of the overlay, shows the scene that is rolling with its time remaining, keeps a log of recent takes, and warns you when no OBS overlay is connected. Then try `!cutscene anime` in Twitch chat.

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start the server and connect to Twitch chat |
| `npm run simulate` | Rehearse all five styles without Twitch |
| `node src/index.js --simulate --once` | Render one rehearsal scene, then exit |
| `npm test` | Run the fast, network-free `node:test` suite |
| `!cutscene [style]` | Request a scene in chat; command is case insensitive |
| `!quiet-modes` | Suppress busy replies for one cooldown window |

Simulation uses fake messages from `clip_enjoyer` and friends, cycles approximately every 14 seconds, and waits for a slow generation/playback to finish before the next scenario. It uses the same director and queue as production, with cooldown set to zero for rehearsal. `--once` waits for generation and playback, then closes the process. A successful local response takes about eight seconds of playback; a timed-out provider can add up to `LLM_TIMEOUT_MS`.

## How it works

```text
Twitch IRC ────────┐
                  ▼
Operator ──► DirectorCut (LLM director) ──► WebSocket ──► OBS overlay
                  ▲    │                                   │
Fake chat ────────┘    └─ deterministic fallback            └─ WebAudio sting
```

One Node process hosts the pages, API, WebSocket server, Twitch connection, and scene queue. The LLM produces a small JSON script. The server validates and truncates captions, clamps playback to 5–12 seconds, and rebuilds every credit from the actual trigger. Chat is untrusted prompt context, and every visible model string is rendered as text.

The production cooldown is shared by chat, hype, and operator requests. Chat commands received while generation or playback is active are declined; an authenticated bot posts a rate-limited busy reply unless quiet mode is active. The operator pipeline supports at most **two waiting scenes** behind one active scene; a third waiting request is dropped and broadcasts `dropped`. Accepted scenes broadcast `cutscene`, finish with `idle`, then advance the queue. Connect an overlay before triggering to see the full sequence; a newly connected overlay waits for the next scene.

## Style presets

| Style | Picture treatment | Default badge | Synthesized sting |
| --- | --- | --- | --- |
| `noir` | Cool duotone, italic cinematic serif, high-contrast vignette | REPLAY | Horror cluster and tremolo |
| `anime` | Magenta/cyan rotating speedlines and italic power typography | LEGENDARY | Filtered noise riser and impact |
| `hollywood` | Warm gold, light leak, widescreen trailer titles | LEGENDARY | A2–E3–A3 brass swell |
| `baywatch` | Sunset orange, soft vignette, slow-motion rescue energy | SLOW-MO | Major arpeggio and timpani-like burst |
| `sportscast` | Electric-blue lower third and scoreboard chip | BREAKING | Major arpeggio and timpani-like burst |

Each treatment has two deterministic fallback scripts that rotate by counter. Network errors, invalid JSON, missing captions, provider errors, and timeouts still produce a complete cutscene. No images, fonts, audio files, CDN resources, or other external assets are used. Everything except Twitch IRC and the LLM request works offline; unavailable LLM requests fall back locally.

## Configuration

All secrets stay in `.env`, which is ignored by Git. `.env.example` contains the full configuration.

| Variable | Default | Meaning |
| --- | --- | --- |
| `TWITCH_CHANNEL` | Required live; `directorcut_rehearsal` in simulation | Channel without `#` |
| `TWITCH_BOT_USERNAME` | Empty | Bot username; required when a token is set |
| `TWITCH_OAUTH_TOKEN` | Empty | Bot token, with or without `oauth:` prefix |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible API root |
| `LLM_API_KEY` | Empty | Empty means no Authorization header, for local providers |
| `LLM_MODEL` | `gpt-4o-mini` | Provider model identifier |
| `LLM_TIMEOUT_MS` | `4000` | Total request budget, including the optional format retry |
| `PORT` | `3000` | Local HTTP and WS port |
| `TRIGGER_COMMAND` | `!cutscene` | Case-insensitive chat command |
| `COOLDOWN_SECONDS` | `20` | Shared production cooldown |
| `HYPE_THRESHOLD` | `0` | Hype-token count to auto-trigger; zero disables |
| `MODERATION` | `auto` | `auto` checks OpenAI captions against the moderation API (fail closed); `off` skips it — the blocklist always applies |
| `TRIGGER_ROLE` | `everyone` | Minimum chat rank for `!cutscene`: `everyone`, `subs`, `vips`, or `mods` |
| `BLOCKLIST_FILE` | Empty | Optional UTF-8 file, one blocked term per line, merged with the built-in list |
| `OBS_URL` | Empty | OBS WebSocket v5 URL (e.g. `ws://127.0.0.1:4455`); enables the vision director and the replay trigger |
| `OBS_PASSWORD` | Empty | OBS WebSocket password, only when OBS requires one |
| `OBS_SOURCE_NAME` | Empty | Screenshot a specific source instead of the whole program scene |
| `OBS_TIMEOUT_MS` | `1500` | Whole-session budget for each OBS capture or replay save |
| `DIRECTOR_VISION` | `off` | `on` sends the captured live frame to a vision-capable director model |
| `TWITCH_CLIENT_ID` | Empty | Twitch app Client-Id; with a user token, enables Channel Points triggers |
| `TWITCH_USER_TOKEN` | Empty | Broadcaster user token with `channel:read:redemptions` and `channel:manage:redemptions` |
| `TWITCH_BROADCASTER_ID` | Empty | Optional; resolved from the token via `/helix/users` when blank |
| `REWARD_TITLES` | Empty | Comma-separated reward titles to react to; blank reacts to every redemption |

For Ollama, set `LLM_BASE_URL=http://localhost:11434/v1`, choose an installed model with `LLM_MODEL`, and leave `LLM_API_KEY` empty. The client sends OpenAI-compatible chat completions with JSON output requested; providers that reject `response_format` are retried once without it. Missing local models or an unreachable endpoint use fallback scripts.

Hype counts whole-word occurrences of `LUL POG POGGERS KEKW W CLIP LETSGO EZ`, case insensitively, in a rolling 30-second window. The exact 30-second expiry is excluded. At the threshold, an idle and cooled-down director starts `sportscast`, credits **EXECUTIVE PRODUCER: CHAT ITSELF**, and debounces further automatic scenes for 60 seconds.

## Vision director, replay trigger, and Channel Points

With `OBS_URL` set, DirectorCut speaks the OBS WebSocket v5 protocol in short, deadline-bounded sessions. `DIRECTOR_VISION=on` captures the live program frame (or `OBS_SOURCE_NAME`) right before each generation, so the director reacts to what is actually on screen; a slow or missing capture silently degrades to the text-only director. `POST /api/replay` saves the OBS replay buffer — the streamer keeps the clip — and cuts a `baywatch` slow-mo scene. Channel Points redemptions (when `TWITCH_CLIENT_ID` and `TWITCH_USER_TOKEN` are set) act as paid triggers: they queue like operator requests, and any redemption the queue cannot honor is refunded via Helix, so a viewer never loses points to a cooldown.

## Safety and moderation

Model output never reaches the overlay unfiltered. Every caption and sub-caption passes a whole-word blocklist (built-in list plus optional `BLOCKLIST_FILE`); when the provider is OpenAI with an API key, they are additionally checked against the moderation endpoint — any flag, error, or timeout fails closed to the deterministic fallback script. Chat-triggered scenes can be rank-gated with `TRIGGER_ROLE`; non-allowed viewers receive silence, never a public rebuff. Chat lines and trigger messages are stripped of URLs and `@mentions` before they reach the model.

## Operator and integration routes

The server binds to loopback (`127.0.0.1`) for local OBS use. Keep the unauthenticated operator API local.

| Route | Behavior |
| --- | --- |
| `GET /` | Landing page and production links |
| `GET /overlay` | Transparent browser-source overlay |
| `GET /overlay?debug=1` | Overlay with WS state, last scene ID, and health round-trip latency during playback |
| `GET /overlay?backdrop=1` | Overlay over a stand-in gameplay backdrop for browser rehearsal |
| `GET /overlay?preview=1` | Muted overlay used by the console monitor; never plays the sting |
| `GET /control` | Operator console: style cards, keyboard shortcuts, cooldown meter, muted live preview, now-rolling card, recent takes, no-overlay warning |
| `GET /healthz` | `{ok, channel, model, uptimeSec, cutscenesServed, wsClients, previewClients, rolling, obs}`; `wsClients` counts real overlays only |
| `POST /api/trigger` | `{style?, user?}` → `202` accepted, `429` cooldown/busy/full, `400` invalid input |
| `POST /api/replay` | Saves the OBS replay buffer and cuts a slow-mo scene; `202`, `429`, or `503` without OBS |
| `WS /overlay?role=overlay\|preview\|control` | `hello` with channel config and style metadata, followed by `cutscene`, `idle`, or `dropped` frames. `role` defaults to `overlay` |

```sh
curl -X POST http://localhost:3000/api/trigger \
  -H 'Content-Type: application/json' \
  -d '{"style":"hollywood","user":"clip_enjoyer"}'
```

The WS client reconnects with exponential backoff capped at five seconds. Local playback also clears itself after its duration if the connection drops. Debug and audio-unlock UI live inside the scene so idle stays perfectly transparent. Reduced-motion preferences suppress flashes and ongoing motion and reveal the caption at once.

## Tests and verification

The test files use only `node:test` and strict assertions, with injected provider mocks and pure chat helpers. They never connect to Twitch or a live LLM; the server test binds an ephemeral loopback port. They cover fenced and wrapped JSON, malformed output, validation and clamping, fallback rotation, credits, cooldown boundaries, hype-window math, command parsing, WebSocket role counting, late-join state, format retries, optional authentication, and timeout aborts.

Install dependencies before running `npm test`. The suite is verified green (18/18).

## Built with OpenAI Codex

Built with **OpenAI Codex**, from the director and rehearsal pipeline to the broadcast package and procedural audio. Codex session: `01a19dc4-534f-7690-b36b-33615188f337`. Post-build human direction passes: OBS-safe compositing (blend modes flattened), a `?backdrop=1` rehearsal backdrop, and WebSocket late-join scene replay. A later UI/UX pass, made with Claude Code, redesigned the operator console and landing page and added the overlay timecode, progress line, long-caption sizing, and muted preview mode.

## Hackathon submission notes

Submission for **Codex x TwitchCon**. Innovation: viewers executive-produce cinematic moments directly from chat. Potential impact: streamers get instant, branded highlights without breaking play. Technological implementation: provider-pluggable generation, validated scripts, deterministic recovery, shared scene scheduling, and entirely synthesized sound in one process. Design: five broadcast treatments, deliberate timing, and a transparent, hands-off OBS overlay.

Suggested demo: open `/overlay` in OBS, run simulation, show noir and anime, then trigger a Hollywood scene from the operator console or live chat. Point out the viewer credit, play a synthesized sting, and demonstrate fallback reliability with an unavailable provider. Use a configured provider for the live AI segment. Record the real overlay over gameplay for the submission video; the operator console is the production desk, while the overlay is the product.

## License

[MIT](LICENSE) © 2026 DirectorCut contributors.

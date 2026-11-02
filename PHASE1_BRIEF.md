# DirectorCut — Phase 1 Build Brief (v2-safety sprint)

Context: this is a hackathon submission (Codex x TwitchCon). The build on `main` is frozen and verified. You are implementing Phase 1 of the v2 roadmap ON THIS BRANCH. Every change must preserve current default demo behavior exactly (a recorded demo video depends on it). Deadline-critical: correctness over ambition. Read `BUILD_BRIEF.md` first for house style: plain Node ≥20 ESM, deps only `tmi.js`, `ws`, `dotenv`, pure exported helpers, dependency injection, `node:test` suites with no network.

Implement ALL of the following. If anything proves riskier than described, SKIP it and note the skip in your summary — never half-wire a feature.

## 1. Output moderation — new `src/safety.js`

- `blocklistHit(text)`: whole-word, case-insensitive match of a small built-in term list against the text. Built-in list: a short array of severe English profanity/slurs placeholders — keep it genuinely short (8–12 terms, harsh only; nothing prudish like "damn"). Also load optional `BLOCKLIST_FILE` (env; one term per line, `#` comments) once at config time; merge with built-ins; empty/missing file is fine. Export a pure `loadBlocklist(env)` and `blocklistHit(text, terms)`.
- `async moderate(texts, llm, { fetchImpl = fetch, log = () => {} })`: only when `llm.baseUrl` includes `api.openai.com` AND `llm.apiKey` is non-empty → `POST {baseUrl}/moderations` with `{ model: 'omni-moderation-latest', input: texts }`, `Authorization: Bearer <key>`, timeout **1500 ms** via AbortController. Response `results[*].flagged` any-true → flagged. ANY error, timeout, or non-ok status → treat as flagged (fail closed) but return a structured result `{ flagged: true, reason: 'error' | 'timeout' | 'flagged' }` so the caller can log why. When not OpenAI or no key → return `{ flagged: false, reason: 'unavailable' }` (blocklist still applies separately).
- In `src/director.js` `createDirector`: after `validateScene()` (and BEFORE returning the scene), run: `blocklistHit(caption) || blocklistHit(subCaption)` → fallback; else `moderate([caption, subCaption], config.llm)` → flagged → `fallbackScene(...)` with log line `director ▸ moderated · fallback`. The moderation call must be bounded by the SAME overall director timeout budget as the LLM call (do not let a slow moderation extend worst-case latency beyond ~1.5 s extra).
- Env: `MODERATION=auto|off` (default `auto`) in `src/config.js` (validate values; invalid → default). `off` skips moderation entirely (blocklist still applies).

## 2. Chat role gating — `src/chat.js` + `src/config.js`

- Pure exported `isAllowed(tags, role)`: `role` one of `everyone|subs|vips|mods`. `everyone` → always true. `subs` → `tags.subscriber` truthy OR `tags.badges` has founder/vip/mod/broadcaster (staff tiers inherit). `vips` → vip badge or mod/broadcaster. `mods` → `tags.mod` truthy or broadcaster badge. `tags` may be undefined → only `everyone` passes. Broadcaster (`tags.badges.broadcaster`) always allowed for every role.
- Config: `TRIGGER_ROLE` env (default `everyone`; invalid value → default).
- Wire into the chat message handler: gate ONLY the `!cutscene` trigger path (hype auto-trigger is unaffected; `!quiet-modes` unaffected). Non-allowed users get no reply (silence — never embarrass a viewer on stream).

## 3. Server-side take counter — `src/server.js` + `public/overlay.js` + `public/overlay.html`

- `createSceneQueue` increments a monotonic `take` starting at 1; include `take` in the broadcast payload: `{ type: 'cutscene', scene, id, take }`. Also include `take` in the late-join replay payload in `createServer` (track it alongside `currentScene`).
- `public/overlay.js` `renderScene(scene, id, take)`: use `take` when it's a positive integer, else fall back to the existing local `sceneNumber` increment (so old payloads still work). Display `TAKE ${String(take).padStart(3, '0')} / LIVE` and scoreboard `CHAT // ${String(take).padStart(2, '0')}`. Keep all animation timing identical.

## 4. Film grain tiles — `public/overlay.js` + `public/overlay.html`

- Replace the per-frame `putImageData` loop with 4 pre-generated 256×256 noise tiles: build once at load via an offscreen canvas, `toDataURL('image/png')`, then animate by cycling `background-image` on a dedicated fixed-position layer (or drawing tiles to the existing #grain canvas every ~80 ms — your choice, but the per-frame full-canvas random loop must go). Remove `image-rendering: pixelated` from `#grain` CSS. Same 8% max opacity, same `display` gating with the scene (`#scene.active #grain` equivalent). Pure visual refactor: when idle, still zero pixels. If the tile approach hits any structural problem, leave the grain as-is and note the skip — do not ship a broken visual.

## 5. Wording
- `src/chat.js` busy reply → `🎬 a cutscene is already rolling, @user — try again shortly` (keep the once-per-cooldown-window throttle exactly as is).

## Tests — extend the existing suites (all `node:test`, no network, follow existing patterns)
- `tests/safety.test.js` (new): blocklist whole-word match + non-match; `loadBlocklist` merges file terms + handles missing file; `moderate` with mocked fetchImpl: clean → not flagged; flagged result → flagged; fetch throws/aborts → flagged with reason 'error'/'timeout'; non-OpenAI baseUrl or empty key → `{flagged:false, reason:'unavailable'}`.
- `tests/director.test.js` (extend): blocklist hit on caption → fallback scene; mocked moderation flagged → fallback; `MODERATION=off` skips the moderation call (fetch not invoked) but blocklist still applies.
- `tests/chat.test.js` (extend): `isAllowed` truth table across roles (everyone/subs/vips/mods) with tags undefined, plain viewer, sub, vip, mod, broadcaster.
- `tests/server.test.js` or extend queue tests: `take` increments across scenes and appears in broadcast payloads (including replay).

## Hard requirements
- `npm test` must pass 100% at the end. No new dependencies. No TODOs. Do NOT touch `README.md`, `.env.example` (I will update docs myself), `src/obs.js`, `src/twitch.js`, `src/eventsub.js`, or anything Phase 2+ — this sprint is Phase 1 only.
- Finish with a one-paragraph summary listing exactly what you implemented and anything you skipped.

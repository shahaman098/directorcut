# SUBMISSION.md — DirectorCut (Codex x TwitchCon)

Paste-ready Devpost text + video script. Facts verified 21:25 GMT, 2 Nov 2026:
`main` @ `19db8be` (viewer pitches, grain-tile fix, JSON-only trigger API, safety fixes, control-room UI), `npm test` → **49/49 pass**, repo public at the URL below.
This file lives on `claude/laughing-goodall-bgvhwx` — paste from here.

## Form fields

- **Project name:** DirectorCut — AI cutscene director for Twitch
- **Tagline:** Viewers type `!cutscene anime one HP clutch with a frying pan` — the pitch becomes story material, an AI director writes the scene, and your stream instantly becomes cinema.
- **Code repo (public):** https://github.com/shahaman098/directorcut
- **Codex session ID:** `01a19dc4-534f-7690-b36b-33615188f337` — re-verify with `/status` in the build thread before pasting
- **Demo video:** `<PASTE YOUTUBE URL>` — upload as **PUBLIC**. The rules require the video to be "made publicly visible on YouTube"; unlisted risks failing a hard requirement. Delete it after judging if you like. Not "made for kids".
- **Screenshots:** 3–4 — overlay mid-scene (noir + anime), operator console showing a viewer pitch in scene details, test suite green, the README architecture diagram.

---

## Inspiration

A streamer's best moment dies in ten seconds. Chat erupts — LULs, clips, Ws — and then the scroll swallows it. Turning that hype into a story means hours in an editor after the stream, and small channels never get the TV-production polish that big broadcasts have. We wanted the hype itself to have a director's chair.

## What it does

DirectorCut is a live cutscene engine for streams:

- Viewers type `!cutscene [style] [what happened]` in Twitch chat — noir, anime, hollywood, baywatch, or sportscast. The optional **viewer pitch** ("one HP clutch with a frying pan") is story material the AI director weaves into the scene: capped at 100 characters, scrubbed of links and @mentions, blocklist-checked, and **never rendered on the overlay** — it shapes the script and shows only in the operator console's scene details and history.
- An **AI director** (any OpenAI-compatible LLM) writes a cinematic scene as validated JSON — caption, badge, sting, duration — reacting to the actual chat hype.
- The cutscene renders **live over the stream** (OBS browser source): letterbox bars, film treatment, word-by-word narration, blinking `● REPLAY` badge — and an **"EXECUTIVE PRODUCER: @viewer"** credit for whoever called it. The viewer isn't an audience member; they produced the moment.
- Chat-hype auto-trigger: when hype in a rolling 30-second window crosses a threshold, the director cuts a scene on its own, credited to **CHAT ITSELF**.
- A WebAudio-synthesized sting scores every scene — no copyrighted audio, no external assets, nothing to load.
- Shown working live in Twitch chat in the demo video — a real viewer message from a real account, captured on camera.

## How we built it

- The core engine — Twitch IRC integration, the LLM director with a tolerant JSON contract, the WebSocket overlay renderer, the WebAudio synth, the rehearsal simulator — was written by **OpenAI Codex in a single session from a written build brief** (session ID above). Human role: directing. Codex role: engineering.
- After the Codex build, directed polish passes added output moderation (blocklist + OpenAI moderation, **fail closed**), chat rank gating, a server-side take counter with late-join replay, film-grain tiles, viewer-pitch intake (length cap, scrubbing, blocklist), and a JSON-only trigger API (requests without a JSON content type get a `415`) — all verified by the same network-free test suite.
- Constraints we set and kept: plain Node.js ESM, three dependencies (`tmi.js`, `ws`, `dotenv`), zero external assets, one process serving overlay + API + WebSocket + chat, secrets only in `.env`.
- Reliability is the design: model output is validated and clamped (5–12 s), captions filtered, credits always rebuilt server-side from the real trigger, and if the LLM is unreachable a deterministic template director still cuts the scene. **The show must go on.**

## Challenges

- Making an overlay that renders **zero pixels when idle** yet erupts broadcast-grade mid-scene — inside OBS's restrictive browser-source environment (blend modes, autoplay policy, transparency).
- Treating chat as untrusted input end-to-end: URL/mention stripping, 100-character pitch caps, JSON tolerance, caption truncation, moderation that fails closed, rate-gated replies.
- Keeping worst-case latency bounded: the entire director pipeline (LLM + moderation) fits in a fixed timeout budget, with a fallback that never leaves chat without a cutscene.

## Accomplishments

- Five distinct broadcast treatments with procedural stings that look directed, not generated.
- A provider-pluggable AI director — OpenAI, or any local OpenAI-compatible endpoint — with a contract a judge can read in one file.
- 49 fast, network-free tests covering the JSON contract, fallback rotation, cooldown/queue boundaries, hype-window math, moderation fail-closed paths, pitch cleaning and blocklist rejection, the JSON-only trigger API, WebSocket role counting, late-join replay, and timeout aborts.
- A demo that survives us killing the LLM live on camera.

## What we learned

Constrained AI beats deterministic code for creative runtime content — but only when the AI's output is treated like any other untrusted input: validated, clamped, filtered, and rehearsed with a fallback. And in OBS-land, "invisible when idle" is a feature you have to engineer as deliberately as the scene itself.

## What's next (roadmap only — none of this is in the submitted code)

Ideas for after the hackathon; **not** implemented, listed so judges can't mistake them for features:

- **Vision director:** the director sees the actual frame via OBS source screenshots and narrates the real moment.
- **Real slow-mo replays** cut from the OBS replay buffer.
- **Channel Points redemptions** ("Executive Producer" as a reward) with automatic refunds, and credited Twitch clips.
- First-class local profile (Ollama default) so the whole thing runs with zero paid APIs.

---

## Video script (target 2:40, hard cap 3:00 — shown running the whole time)

1. **0:00–0:12 Hook.** Overlay fires over gameplay. "Chat just directed a movie trailer about my last play — and the viewer who called it got the executive producer credit."
2. **0:12–0:22 Problem.** Big moments vanish in the chat scroll, and viewers have no part in the production.
3. **0:22–1:20 Live demo, real Twitch chat.** At 0:22 a viewer types `!cutscene anime one HP clutch with a frying pan` — voice-over: "the director wrote the scene around that pitch." The scene plays with credit and sting. Then noir and hollywood as plain triggers. Mention cooldown and the graceful "already rolling" queue.
4. **1:20–1:50 Reliability.** "Chat is untrusted input." Break the LLM endpoint live — a scene still plays. Captions pass a blocklist and moderation, fail closed; duration clamped; credits rebuilt server-side.
5. **1:50–2:15 Tech.** One Node process, transparent OBS browser source, all audio synthesized, any OpenAI-compatible provider including local Ollama, 49 network-free tests, built with Codex — show `/status` with the session ID for ≥5 s.
6. **2:15–2:40 Impact and next.** "Next: the director sees the actual frame, real slow-mo replays, Channel Points redemptions." Close on a scene. End card: repo URL + "Built with OpenAI Codex × Twitch".

## Pre-submit checklist

- [x] `npm test` green — 49/49 verified 21:22 GMT on `main` @ `19db8be`
- [ ] One manual trigger from `/control` with the overlay open in OBS before recording
- [ ] Recording settings: `HYPE_THRESHOLD=4`, `COOLDOWN_SECONDS=8`, real `LLM_API_KEY`; restore `.env` after. **Pitches need a working LLM key** — with the fallback director, commands still work but pitches are ignored.
- [ ] Video ≤ 3:00, uploaded **PUBLIC**, plays logged-out
- [ ] Video shows real Twitch chat + Codex `/status` session ID held ≥5 s
- [ ] Repo public; fresh clone → `npm install` → `cp .env.example .env` → `npm start` works from README alone
- [ ] Devpost form: paste text above, repo URL, video URL, session ID, screenshots → **SUBMIT before 22:00 GMT**
- [ ] Re-open the submission and confirm the video plays logged out

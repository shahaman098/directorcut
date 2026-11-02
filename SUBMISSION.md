# DirectorCut — Devpost submission

## Project name
DirectorCut

## Tagline (Devpost "elevator pitch")
Chat calls the cutscene. An AI director writes the trailer. The viewer who called it gets the executive producer credit, live over the stream.

## Built with
javascript, node.js, openai, codex, twitch, tmi.js, websockets, obs-studio, web-audio-api

## Links
- Repo: https://github.com/shahaman098/directorcut
- Demo video: <YouTube unlisted link>
- Codex session ID: 01a19dc4-534f-7690-b36b-33615188f337 (confirm with `/status` in Codex before submitting)

---

## Inspiration
The best moments on stream disappear into the chat scroll in about four seconds. Viewers spam "CLIP IT", someone maybe makes a clip, and the moment is gone. We wanted chat to do more than react. We wanted viewers to *produce* the moment, live, with their name on it.

## What it does
A viewer types `!cutscene` (optionally `!cutscene anime`, `noir`, `hollywood`, `baywatch` or `sportscast`). Within seconds:

- An **AI director** writes a miniature movie-trailer script about the moment, using recent chat as context.
- A **cinematic overlay** takes over the stream in OBS: letterbox bars, a style-specific grade, film grain, typewriter narration, a REPLAY / LEGENDARY / BREAKING badge and a running timecode.
- A **synthesised sting** plays: brass swell, horror cluster, anime riser or heroic burst. It's all generated with Web Audio, so there are no audio files and no copyright risk.
- The bottom bar credits **"EXECUTIVE PRODUCER: @viewer"**, the person who called it.
- The overlay exits and goes back to fully transparent. It renders nothing between scenes, so it can sit over gameplay all stream.

It also includes:
- **Hype auto-trigger:** when chat floods with POG / KEKW / LETSGO, a sportscast scene fires, credited to "CHAT ITSELF".
- **Streamer controls:** a shared cooldown, a two-scene queue, `!quiet-modes`, and `TRIGGER_ROLE` to limit triggers to subs, VIPs or mods. Viewers who aren't allowed get silence, never a public rebuff.
- **A control-room console** at `/control`: live program preview, style picker, keyboard triggers, a remaining-time bar, scene history, and a warning if no OBS overlay is connected.

## How we built it
We built DirectorCut with **OpenAI Codex**, from the director pipeline and rehearsal mode to the broadcast graphics and procedural audio. Post-build polish passes are listed in the README.

- **One Node.js process**, no build step, three dependencies (`tmi.js`, `ws`, `dotenv`). It serves the overlay, console, health endpoint and WebSocket, and connects to Twitch chat.
- **Twitch chat** via IRC, anonymous read-only or as a bot with replies ("CUTSCENE INITIATED for @viewer…").
- **AI director:** any OpenAI-compatible endpoint (OpenAI by default, local Ollama supported). The model returns a small JSON script. The server validates it, truncates captions, clamps duration to 5–12 s and **rebuilds the credit from the real trigger**, so the model never decides who gets credited.
- **Constrained AI, deterministic safety net:** if the model is slow, offline or returns invalid JSON, a hand-written fallback script for that style plays instead. A scene always plays.
- **Safety by default:**
  - Chat is treated as untrusted input. Links and @mentions are stripped before chat reaches the model.
  - Every caption passes a blocklist.
  - With an OpenAI key, captions are also checked by the moderation endpoint, and anything flagged, slow or erroring falls back to a safe script (fail closed).
- **Broadcast-grade overlay:** transform/opacity-only animation, a transparent OBS browser source at 1920×1080, reduced-motion support, and late-join recovery: if OBS reloads mid-scene, the overlay resumes the live scene with the correct take number and timecode.
- **42 network-free tests** (`node:test`) covering JSON extraction, validation, fallbacks, cooldown and hype-window maths, role gating, moderation (including fail-closed), the take counter and late-join replay.

## Challenges we ran into
- **Making AI safe to put on someone else's stream.** Chat can attempt prompt injection, so the model's output had to be bounded, validated, moderated and always recoverable.
- **OBS compositing.** Browser sources don't handle every CSS blend mode the way Chrome does, so we flattened the look into layers that composite reliably.
- **Autoplay audio.** OBS allows it, but regular browsers block it. We added an unlock button that appears only inside a scene, so the idle overlay stays empty.
- **Reloads mid-scene.** OBS reloads browser sources more often than you'd expect, which is why the server replays the active scene with its remaining duration.

## Accomplishments that we're proud of
- It goes from `!cutscene` to a full cinematic scene with sound in seconds, and when idle it renders nothing over gameplay.
- Five distinct broadcast treatments with matching synthesised stings, and zero external assets.
- It never fails on air: no API key, a dead endpoint or a moderation flag all still produce a scene.
- Setup takes about 60 seconds: `npm install`, set your channel and key, add one OBS browser source.

## What we learned
LLMs work best on stream as a **constrained creative layer** over deterministic code: small JSON contract, strict validation, server-owned identity, and a fallback for every failure. Design matters as much as the model. If it doesn't look like a real broadcast package, streamers won't put it on their stream.

## What's next for DirectorCut
- **The director sees the moment:** grab the live frame through OBS WebSocket so captions describe what actually happened.
- **Real slow-motion replay:** play the last few seconds from the OBS replay buffer under the letterbox.
- **Channel Points redemptions** via EventSub, with automatic refunds when the queue is full.
- **Auto-clips:** create a Twitch clip of the moment and post it in chat with the producer's credit.

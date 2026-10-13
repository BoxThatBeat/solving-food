# M11 — Hands-free mode

Status: in progress

## Goal

A voice assistant for cooking: the app reads the recipe aloud and listens for a few spoken commands, with speech
recognition and speech synthesis both on the device. One feature request from the owner (2026-10-13), turned into
ordered tasks; decisions taken without the owner (the run was unattended) are recorded under "Decisions".

> "New Feature: A voice assistant in recipe's step mode.
> - Both talking to you and listening to you for commands
> - You can say "next", "previous, back, before" to go to the next step or to the previous step
> - you can say "ingredients" for it to read the ingredients. You can say "steps, instructions" for it to read the step
>   instructions
> - "stop" makes it stop talking immediately.
> - "mute, shut up" enables mute, "unmute" disables it.
> - Call it "hands free mode" which should always have a small toggle on every page (will instantly mute the model if
>   pressed). Audio is never recorded when disabled. The voice starts the default reading ingredients then
>   instructions (or just mise en place) when toggled on
> - Audio never leaves the device local only
> - It should be available as an option in the mise en place section onwards.
> - By default the voice reads the ingredients, then the instructions when entering a new step of the recipe
> - The user can say full sentences but the app just looks for the keywords. If there are two or more keywords in one
>   sentence, it should take the last spoken one as the correct command
> - The user should be able to talk over the voice.
> - The app should listen with a buffer of 1.5 seconds after silence before doing STT
> - The STT and TTS should all be locally run on device.
> - Don't include the details of this feature as text in the UI of the actual app.
> Use a Web Worker for inference. A Worker is worth considering if you use a browser-based STT model. It keeps
> inference work away from the main UI thread so recipe controls can remain responsive. Also, keep microphone capture
> and audio playback lifecycle management separate from the model worker so you can interrupt speech immediately,
> regardless of how long inference takes.
> For TTS use the built in browser api: `const utterance = new SpeechSynthesisUtterance(text); utterance.lang =
> "en-CA"; speechSynthesis.speak(utterance);`
> For STT use Whisper Tiny.en via Transformers.js."

## Requirements covered

R4.31 (new: the hands-free toggle), R4.32 (new: voice commands), R4.33 (new: what it reads and when), R4.34 (new:
on-device audio, nothing recorded while off).

## Items (in build order)

### 1. Command grammar and audio maths in core (R4.32)
- [x] `packages/core/src/handsFree.ts` (no browser imports): `parseVoiceCommand(transcript)` → `next | previous |
      ingredients | steps | stop | mute | unmute | none` by whole-word keyword search, case and punctuation
      insensitive, the **last** keyword spoken wins; "unmute" (also "un-mute", "un mute") is never read as "mute";
      "shut up" is mute. `stripEcho()` (the app hearing itself), `SpeechSegmenter` (energy VAD, 1.5 s of silence ends a
      segment, 15 s cap), `downsample()` to 16 kHz, `speakable()` (units and fractions read as words).
- [x] Unit tests: every keyword, last-wins ("go back to the previous one, no wait, next"), mute vs unmute, "shut up",
      empty and garbage transcripts and Whisper's `[BLANK_AUDIO]`, echo stripping, the segmenter's 1.5 s rule and cap.

### 2. Voice engine, lazy and on-device (R4.32–R4.34)
- [x] `apps/web/src/voice/handsFree.ts` (main bundle, small): the device setting (`localStorage sf.handsFree`), the
      state the toggle shows, the page's reading script, and a dynamic `import()` of the engine on first use.
- [x] `voice/engine.ts` (lazy chunk): wires the mic, the worker and the speaker; commands → actions.
- [x] `voice/mic.ts`: `getUserMedia({ audio: { echoCancellation, noiseSuppression, autoGainControl } })`, an
      AudioWorklet (blob module; ScriptProcessor fallback) at the device rate, downsampled to 16 kHz, segmented by
      `SpeechSegmenter`; `stop()` stops every track and closes the AudioContext.
- [x] `voice/stt.worker.ts`: Transformers.js `pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny.en")`,
      WebGPU when available, else WASM (single thread, q8); receives Float32 PCM, returns text; nothing else.
- [x] `voice/speaker.ts`: `SpeechSynthesisUtterance` (`lang = "en-CA"`), one utterance per sentence, `cancel()` at
      once, remembers what it said for the echo filter.
- [x] e2e seam `voice/fake.ts`: only in emulator builds and only when a test sets `window.__handsFreeFake`; a fake mic
      (reports on/off) and a fake recogniser (`window.__handsFree.hear(text)`). Not in the production bundle.

### 3. The toggle on every cooking page (R4.31, R4.33)
- [x] `<HandsFreeToggle>`: icon + switch, `role="switch"`, accessible name "Hands-free", ≥ 44 px; states off, loading,
      listening, speaking, muted, error; no text explaining the commands anywhere.
- [x] In the cook header on mise en place and step mode, and on the review; the mise en place, step mode pages register
      what to read (mise: the prep list; a step: its ingredients then its instructions) and next / previous.
- [x] Errors (microphone blocked, no speech synthesis, no audio worklet, model failed) → an error banner, the toggle
      switches itself off; the cook carries on.

### 4. Build, documents, tests
- [ ] Workbox: the voice chunks are not precached (only people who use the feature download them); spec §2 quota row.
- [ ] PRD R4.31–R4.34; spec §12 (voice architecture, worker, model source and caching, test seam), §2, §14.1; SETUP.md.
- [ ] e2e `hands-free.spec.ts` (@R4.31–@R4.34) and an axe check of the cook page with the toggle on.
- [ ] Design pass (phone, desktop) and accessibility (contrast, 44 px, focus ring).

## Decisions

(filled in as items land)

## Verification

(filled in at the end)

## Owner checks

(filled in at the end)

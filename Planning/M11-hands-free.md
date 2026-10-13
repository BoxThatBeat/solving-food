# M11 — Hands-free mode

Status: done (owner checks below: try it on the phone; deploy is the owner's)

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
- [x] Workbox: the voice chunks are not precached (only people who use the feature download them); spec §2 quota row.
- [x] PRD R4.31–R4.34; spec §12 (voice architecture, worker, model source and caching, test seam), §2, §14.1; SETUP.md.
- [x] e2e `hands-free.spec.ts` (@R4.31–@R4.34) and an axe check of the cook page with the toggle on.
- [x] Design pass (phone, desktop) and accessibility (contrast, 44 px, focus ring).

## Decisions

- **Where the toggle is ("every page" vs "mise en place onwards"):** on every page of a cooking session from mise en
  place on: the cook header on mise en place and on every step, and the review's header. Not on a meal's order list
  (before mise en place) and not on the app's other pages: there is nothing to read there, and a toggle that leaves the
  microphone open while browsing would break "audio is never recorded when disabled" in spirit. The **setting is
  remembered per device** (`localStorage`), so if it was left on it comes back on at the next cook's mise en place; the
  microphone itself is only open while one of those pages is showing (it closes 800 ms after leaving, which lets the
  move from the last step to the review keep it open).
- **Reading:** switching on reads the current page at once, before the model has finished loading (TTS doesn't need
  it): mise en place → its prep list only ("or just mise en place"); a step → "For step n:", its ingredients, then
  "Step n." and the instructions. The instructions are read with ingredient names but **without the inline amounts**
  (they were read a second earlier). Entering mise en place or a new step reads it; the review has nothing to read
  (the toggle is there to switch it off, and stop/mute work).
- **Commands:** exactly the owner's keywords plus plural/joined forms Whisper produces ("un-mute", "shutup"); singular
  "step" and "ingredient" are not keywords, so "next step" is next and not "steps". In mise en place "next" starts step
  mode, "ingredients" reads every ingredient and "steps" the prep list. "Next" on the last step does nothing: finishing
  sends `finishCooking` (it deducts Supply), which shouldn't happen on a misheard word. While muted, nothing is read,
  including an explicit "ingredients" or "steps" (mute means silence until "unmute"); unmute says nothing by itself.
  The toggle off clears mute.
- **Echo (the app hearing itself through speakers):** `echoCancellation` on the stream, plus `stripEcho()`: when a
  transcript of 3+ words is ≥ 60 % words the app said in the last 8 s, those words are dropped before looking for a
  keyword. A keyword the user says over the voice survives (it isn't in the spoken text, or the transcript is short);
  a keyword that is itself in the text being read ("Next, add…") is ignored while it's echo. One- and two-word
  transcripts are always taken as heard.
- **Voice activity:** an energy detector in core (`SpeechSegmenter`) rather than a second model (Silero VAD would be
  another download): the threshold tracks the room (3.5× the quietest frame of the last 3 s), so a range hood stops
  counting as speech after a few seconds; a segment is sent 1.5 s after the voice stops (owner's buffer), capped at
  15 s; under 200 ms of voice is dropped.
- **Model and backend:** `onnx-community/whisper-tiny.en`; WebGPU when the device offers an adapter (fp32 encoder, q4
  decoder, as Transformers.js' Whisper examples do), else WASM q8. No COOP/COEP headers: single-threaded WASM is fast
  enough for tiny.en and cross-origin isolation (COEP) would block the Storage-hosted recipe images and risk Firebase's iframes.
  No CSP exists, so none had to change.
- **Where the files come from (free tier):** model weights from the Hugging Face Hub, ONNX Runtime's WASM from jsDelivr
  (the library's default), both cached in the browser by the library. Nothing on Firebase Hosting but the ~550 kB
  worker script, which isn't precached by Workbox (only people who switch it on download it, then a runtime
  `CacheFirst`). The build drops the 27 MB WASM copy onnxruntime-web would put in `dist`. Spec §2 row added.
- **Code split:** `voice/handsFree.ts` + `<HandsFreeToggle>` (state, toggle, icons) ship in a 6.3 kB chunk loaded with
  the cook and review routes; the engine (`engine.ts`, `speaker.ts`), the mic and worker client (`input.ts`, `mic.ts`)
  and the worker are separate lazy chunks, imported the first time hands-free starts. The e2e fake is only in emulator
  builds (`import.meta.env.VITE_USE_EMULATORS` is a build-time constant); checked absent from the production bundle.
- **UI:** a 44 px chip in the header (mic icon + a small switch; the word "HANDS-FREE" in mono only from `md` up),
  `role="switch"`, accessible name "Hands-free", the green accent when on. State in the icon only: mic-off (off), spinner
  (starting; `motion-safe` only), mic (listening), speaker (speaking), crossed speaker (muted); a screen reader hears
  the state through `aria-describedby`. On phones the "☀ AWAKE" badge shows its sun only (the word is screen-reader
  text) to make room. No text anywhere describes the commands. Errors use the existing error banner.
- **iOS / Safari:** the same code (AudioWorklet and `speechSynthesis` exist on iOS 14.5+/16+). An AudioContext that
  starts suspended (hands-free came back on without a tap) resumes on the next tap; see owner checks.

## Verification

- `pnpm lint`, `pnpm -r typecheck`: clean. `pnpm test`: core 656/656 (+48: `parseVoiceCommand` incl. last-wins,
  mute/unmute, garbage and `[BLANK_AUDIO]`; `stripEcho`; `SpeechSegmenter` 1.5 s rule, cap, clicks, noisy room;
  `downsample`; `speakable`; `sentences`; `ingredientSpeech`), web 11/11. Functions and rules untouched (not run).
  `pnpm e2e:coverage`: M11 4/4 tagged.
- Playwright (`scripts/e2e.sh`, one project per emulator session, 2 workers):
  - desktop-1080p: hands-free, cooking, timers, review, a11y, leftovers: 28 passed, 1 skipped (touch-only swipe);
    every `@smoke` test: 19/19.
  - phone-android: hands-free, cooking, timers, review, a11y: 26/26.
  - phone-ios (WebKit): hands-free, cooking, timers, review: 18/18.
- **Real model, real audio path** (headless nixpkgs Chromium, Vite dev server, a throwaway harness page that runs
  `realInput()`, Chromium's fake microphone fed a 22 kHz espeak-ng WAV of "Okay, go back to the previous one. No wait,
  next please." with 3 s of silence): getUserMedia → AudioWorklet → 16 kHz → segmenter → worker. The worker downloaded
  the q8 encoder (10.1 MB) and decoder (30.7 MB), tokenizer (0.6 MB) from the Hub and ONNX Runtime's WASM (5.5 MB) from
  jsDelivr, was ready in 10.8 s, and transcribed each loop of the file exactly ("Okay, go back to the previous one. No
  wait, next please.") → `next`. After a reload it was ready in 3.3 s with no network downloads (Cache API). Headless
  Chromium has no GPU, so this was the WASM path; WebGPU wasn't exercised.
- Production build: the main entry `index-*.js` 293.6 → 297.3 kB (+3.7 kB raw, mostly the lazy-chunk preload
  table); the shared chunks +0.85 kB; `CookSession` +0.8 kB; new lazy chunks: `HandsFreeToggle` 6.3 kB (2.6 kB gzip, with
  the cook routes), `engine` 1.9 kB, `input` 3.7 kB, `stt.worker` 546 kB (not precached). Precache 105 entries, 3.46 MB.
  No `.wasm` in `dist`.
- Design pass (Latte; phone 412×915 and 360×640, desktop 1920×1080; screenshots in the session scratchpad): the chip sits
  between the title and Done cooking, same height family as the ✕ button, accent when on; at 360 px the title truncates
  ("Shots …") and nothing wraps; the focus ring shows on desktop. The prototype has no voice control: the chip reuses its
  header chip, hard shadow, mono kicker and accent patterns.

## Owner checks

- Deploy, then on the phone open a recipe → Cook → mise en place → tap the mic chip. Allow the microphone. The first
  time it downloads the speech model (~45 MB; on Wi-Fi it took ~11 s here, longer on mobile data; afterwards it starts
  in a few seconds with no download). It reads the prep list at once.
- Try it **with headphones** and **with the phone's speaker**: say "next", "go back", "ingredients", "instructions",
  "stop" while it talks, "shut up", then "unmute". Over the speaker, check it doesn't act on its own words (a step that
  contains "next" or "stop" is the case to watch). Tell me if it's too eager (picks up kitchen noise) or too slow (it
  waits 1.5 s of silence, then needs about half a second to transcribe on a phone).
- Switch it off: the browser's microphone indicator should disappear immediately. Leave the cook view with it on:
  the indicator should disappear within a second; it comes back on at the next cook's mise en place.
- **iPhone / Safari:** the microphone works in Safari and in the installed app (iOS 14.5+ for the audio worklet), but
  iOS may ask for the microphone every visit and doesn't let a page speak until you've tapped something: if it came back
  on by itself and stays silent, tap the screen once. iOS reads with its own voices (an "en-CA" one if installed,
  otherwise English); the mute switch on the side of the phone silences `speechSynthesis` on some iOS versions.
- Not verified here (no real microphone or phone in this environment): real-room voice detection and echo behaviour,
  timing on a phone, WebGPU, iOS Safari, Firefox Android.

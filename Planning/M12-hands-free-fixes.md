# M12 — Hands-free fixes

Status: done (owner checks below: iPhone and Linux speech; deploy is the owner's)

## Goal

Make hands-free mode (M11) actually read aloud on the owner's devices, and stop it crash-looping the iPhone. One bug
report from the owner (2026-10-13), turned into ordered tasks; decisions taken without the owner (the run was
unattended) are recorded under "Decisions".

> "Doesn't seem to fully work. Me commanding it seems to work but I don't hear any reading."
>
> Tested on Linux Chromium and on iPhone Safari (both the tab and the installed PWA). Never said mute. Console on
> Chromium: `No available adapters.` (twice) and `stt.worker.ts:39 Failed to cache ort-wasm-simd-threaded.asyncify.wasm:
> NetworkError: Failed to execute 'put' on 'Cache': Cache.put() encountered a network error`.
>
> "Also on my phone, the page kept reloading until 3 times and Safari said A problem repeatedly occurred on "URL". I see
> the toggle switch of the feature have a spinner while it gets in a crash loop. This didn't happen on my Chromium test."

**Diagnosis** (from reading the M11 code):

- `speaker.ts` called `speechSynthesis.cancel()` and `speak()` in the same tick (Chrome drops that utterance), didn't
  keep utterances referenced (Chrome can garbage-collect them before `onend`), ignored `e.error`, read `getVoices()`
  without waiting for `voiceschanged`, and never noticed an empty voice list (Linux Chromium without speech-dispatcher
  has no voices: `speak()` is silent). The engine only checked that the API exists.
- `start()` spoke the first read after two `await import(…)`s: on Safari the tap's user activation had expired, so
  `speak()` failed (`not-allowed`) silently. Safari needs an utterance spoken inside the tap handler.
- A remembered "on" started the engine on page load with no gesture. On the iPhone the model load killed the page
  (most likely the WebGPU path: Safari 26 exposes `navigator.gpu`, so the worker loaded the fp32 encoder on the GPU),
  Safari reloaded, the setting was still on, it started again → "A problem repeatedly occurred".
- The jsDelivr `Cache.put` failure is the library's own WASM cache: harmless, but a re-download every visit.

## Requirements covered

R4.31 (changed: no start without a tap; reading-unavailable state), R4.33 (unchanged behaviour, now reliable), R4.34
(unchanged).

## Items (in build order)

### 1. No engine start without a tap (R4.31)
- [x] The engine (imports, microphone, model) starts only from a tap on the toggle. A fresh page load shows the toggle
      off; within the same page session the choice carries across cooking pages (mise en place → steps → review →
      the next cook).
- [x] PRD R4.31 and spec updated.

### 2. Crash-loop guard (R4.31)
- [x] `sf.handsFree.starting` (localStorage) is set when the engine starts loading and cleared when it's ready, on a
      clean stop or failure, and on `pagehide`. A page that loads with it set treats the last start as a crash: the flag
      is cleared, the toggle shows its error state, the error toast says hands-free couldn't start on this device, and
      nothing starts.

### 3. Safari unlock (R4.31, R4.33)
- [x] In the toggle's click (synchronously, before any `await`, in the main bundle) speak a single-space utterance,
      kept referenced until it ends; `speechSynthesis.resume()` when it's paused.

### 4. Speaker robustness (R4.33)
- [x] `speaker.ts`: cancel only when its own utterances are pending; after a cancel the first `speak()` of the next batch
      waits a macrotask; every utterance kept in an array until `onend`/`onerror`; one wait for `voiceschanged` (1 s
      timeout) before the first read; voice choice as before; `onstart` + a 4 s watchdog on the first utterance of a
      batch; `e.error` mapped (`interrupted`/`canceled` normal; `not-allowed`, `synthesis-unavailable`,
      `synthesis-failed`, `audio-busy`, `language-unavailable`, `voice-unavailable` → unavailable). Sentence splitting
      kept.

### 5. Surface failures (R4.31)
- [x] Speech unavailable (no API, watchdog with no voices, a failure error): the toggle shows its error state, a toast
      says this device can't read aloud, `console.warn("[hands-free] …")`; listening and commands keep working and the
      setting stays on. Mic/model failures switch it off as before. A TTS failure never calls `fail()`.

### 6. Model path on Safari (R4.34)
- [x] `stt.worker.ts`: the page tells the worker whether to try WebGPU: never on Safari/iOS (WebKit: WASM q8), never
      when this device already reported no adapter (`sf.handsFree.gpu = "0"`, written when `requestAdapter()` returns
      null). The worker posts `error` when `pipeline()` throws; the page treats a worker `error`/`messageerror` as a
      model failure, also after the model is ready.

### 7. Runtime caching through the service worker
- [x] Workbox `runtimeCaching`: CacheFirst for `cdn.jsdelivr.net/npm/onnxruntime-web@…/dist/` (few entries, long
      expiry). Hugging Face model files: checked whether `transformers-cache` keeps them; spec §2/§12 notes.

### 8. Tests
- [x] Unit tests (`apps/web/src/voice/speaker.test.ts`) against a fake `speechSynthesis`: cancel-then-speak ordering
      (the fake drops a speak in the same tick as a cancel, like Chrome), utterances kept until end, empty voice list →
      unavailable, `not-allowed` → unavailable, `interrupted` normal, watchdog.
- [x] e2e `hands-free.spec.ts`: no auto-start on load; crash-loop guard; speech unavailable while commands still work;
      the existing tests with the new timing. Tags R4.31–R4.34; `pnpm e2e:coverage`.
- [x] Design pass of the toggle's error state (phone, desktop).

### 9. Documents
- [x] PRD R4.31–R4.34, spec hands-free section, §2 row, §14.1 row, SETUP.md, `Planning/README.md`, this plan.

## Decisions

- **No start without a tap (item 1):** the remembered setting is gone rather than kept as a hint. A fresh page load
  always shows the toggle **off** (`data-state="off"`), and M11's `localStorage sf.handsFree` is removed on load so an
  old "on" can't come back. Within the same page session the choice still carries across cooking pages (mise en place
  → steps → review → the next cook's mise en place): that page already had its tap (speech is unlocked), and the crash
  guard covers the model load. A "remembered, tap to resume" hint state was considered and dropped: it would be a
  second look for the same "off" switch, and the owner asked for no explanatory text. PRD R4.31 reworded.
- **Crash guard (item 2):** `sf.handsFree.starting` is set at the start of `start()` (before the lazy imports) and
  cleared once the microphone and model are ready, on any stop or failure, and on `pagehide` (a normal reload or
  closing the tab mid-download isn't a crash; a killed WebContent process fires no `pagehide`). Detected when the
  hands-free module loads (with the cook routes): the flag is removed (so one bad start costs one warning, not a
  loop), the toggle shows its error look (off), and the existing error banner says "Hands-free couldn't start on this
  device, so it's off." A tap tries again.
- **Safari unlock (item 3):** `setEnabled(true)` speaks `" "` (lang en-CA) synchronously in the click, kept in a module
  variable until it ends; it also calls `speechSynthesis.resume()` but only when `paused` is true (harmless, and
  un-sticks Chrome/Safari after the page was backgrounded mid-utterance). The speaker doesn't count the unlock as its
  own, so the first read never cancels it (no cancel/speak race on the first read).
- **Speaker (item 4):** `say()` records its sentences for the echo filter at once, waits for voices (once per engine),
  then speaks; it only cancels when one of its own utterances is queued or a batch is waiting, and the batch after a
  cancel goes a macrotask later. The watchdog (4 s) watches the first sentence of each batch only: a long first
  sentence that has started is fine. A first sentence that ends without `onstart` on a device with no voices also
  counts as unavailable (some Chromium builds end it at once instead of hanging). After "unavailable" the speaker
  stays silent (no repeated watchdogs or warnings) until hands-free is switched off and on (`reset()`).
- **Voice choice (item 4, from a check of the owner's Linux Chromium with speech-dispatcher, sent mid-run):** espeak-ng
  lists ~15,000 voices (~950 English, variants with "+" in the name, none default) and `voiceschanged` fires twice
  (0 voices, then the list ~2 s later). So `pickVoice()` ranks once per list change (en-CA, then no "+", then not
  espeak-ng, then local, then list order), `voiceschanged` is listened to for the engine's lifetime, the first read
  waits at most 1 s and then goes with `lang` alone, and a first read that was queued before the list arrived and never
  started gets one retry with the new voice when the watchdog fires (instead of "unavailable"). The e2e stub keeps
  returning a voice and firing `onstart`, so the watchdog never fires a banner in normal e2e runs (headless Chromium has
  no TTS at all).
- **Speech unavailable (item 5):** a separate `problem: "speech"` in the hands-free state: the toggle stays checked,
  shows the error look (warning icon on `red-soft`, screen-reader state "Listening, can't read aloud"; muted still
  shows muted), and the banner reads "This device can't read aloud right now. Hands-free is still listening." No
  `speechSynthesis` at all is the same state now (M11 switched hands-free off for it): the commands still work without
  a voice. Mic/model failures keep M11's behaviour (off + banner) and now also get the error look until the next tap.
- **WebGPU (item 6):** the page decides and passes `gpu` to the worker. WebKit is detected on the page by
  `navigator.vendor` starting with "Apple" or an iPhone/iPad/iPod UA (covers iOS Chrome/Firefox, which are WebKit, and
  iPadOS). `no-gpu` is only remembered for "no adapter"; a WebGPU pipeline that throws still falls back to WASM for
  that start but isn't remembered (it may be a transient failure). A worker crash after the model is ready disposes the
  worker and switches hands-free off with "The speech model stopped working, so hands-free mode is off." No load
  timeout: on mobile data the first 45 MB download can legitimately take minutes.
- **Service-worker cache (item 7):** Workbox `CacheFirst` for `cdn.jsdelivr.net/npm/onnxruntime-web@<v>/dist/*`
  (`hands-free-runtime`, 6 entries, 1 year, status 200 only): the URLs are versioned, so a new library version simply
  makes new entries and the old ones age out. The model files from huggingface.co (and its CDN redirect) are already
  kept by the library's `transformers-cache` (M11 measured a no-download restart; re-checked below), so no second copy.

## Verification

- `pnpm lint`, `pnpm -r typecheck`: clean. `pnpm test`: core 656/656, web 24/24 (+13: `voice/speaker.test.ts` with a
  fake `speechSynthesis` that drops a `speak()` in a `cancel()`'s task like Chrome: reading order and en-CA voice,
  no cancel when idle + next batch a task after a cancel, utterances kept until end, repeated `voiceschanged` re-pick,
  one retry for a late voice list, the 1 s voices wait, no voices → unavailable after the watchdog (and no repeat until
  `reset()`), a refused speak → watchdog, a long started read doesn't trip it, `not-allowed` → unavailable,
  `interrupted`/`canceled` normal, the echo memory; `pickVoice` ranking over a 2,000-variant espeak-style list). The
  ordering test was checked to fail with the M11-style same-task speak.
- `pnpm e2e:coverage`: M12 3/3 tagged (R4.31, R4.33, R4.34; R4.32 also tagged by the new speech test).
- Playwright (`scripts/e2e.sh`, one project per emulator session, 2 workers), `hands-free.spec.ts` now 8 tests (+3: no
  start on load with M11's remembered setting, the crash-loop guard, a device that can't read aloud keeps taking
  commands; the M11 tests now tap to start, check the unlock utterance and the starting flag, and a reload starts off):
  - desktop-1080p: hands-free, cooking, timers, review, a11y, leftovers: 31 passed, 1 skipped (touch-only swipe);
    every `@smoke` test: 19/19. (A first run, under load, failed once in `a11y.spec.ts` "M4 pages" on
    `/settings/members` waiting for the Invites region; it passed on the re-run and touches nothing in M12.)
  - phone-android: hands-free, cooking, timers, review, a11y: 29/29.
  - phone-ios (WebKit): hands-free, cooking, timers, review: 21/21.
- **Real model** (headless nixpkgs Chromium, the emulator build served by `vite preview`, the app's service worker
  controlling the page, the built `stt.worker` fed an espeak-ng recording of "Okay, go back to the previous one. No wait,
  next please." resampled to 16 kHz): the worker posted `no-gpu` (headless has `navigator.gpu` but no adapter), loaded
  WASM q8 in 16.0 s from an empty cache, and transcribed it exactly in 3.0 s. Caches afterwards: `transformers-cache` holds
  the model files from huggingface.co (and the WASM), and the new `hands-free-runtime` holds
  `ort-wasm-simd-threaded.asyncify.{wasm,mjs}`; the worker's jsDelivr requests were answered by the service worker.
  After a reload: ready in 3.1–3.3 s with no request to huggingface.co or jsDelivr. The mic path (`mic.ts`) is
  unchanged since M11's fake-microphone check.
- Production build: main entry `index-*.js` 297.3 kB (unchanged); lazy chunks `HandsFreeToggle` 6.3 → 7.8 kB (unlock,
  crash guard, error look), `engine` 1.9 → 4.4 kB (the speaker), `input` 3.7 → 4.2 kB, `stt.worker` 546 kB (not
  precached). Precache 105 entries, 3.46 MB. No `.wasm` in `dist`, no e2e fake in the bundle, the jsDelivr route in
  `sw.js`.
- Design pass (Latte; phone 412×915, desktop 1920×1080; screenshots in the session scratchpad): the error look is the
  same chip with a warning icon on `red-soft` (ink on it ≈ 5.6:1), next to the existing red error banner; off after a
  crash (switch knob left) and on while it can't read aloud (knob right, "HANDS-FREE" from `md` up). Nothing wraps at
  phone width. The prototype has no voice control; this reuses its chip, banner and red token.
- **Not verifiable here:** real Safari / iPhone (the unlock utterance, the WASM path on iOS, memory during the model
  load), a real Linux Chromium with speech-dispatcher (only the coordinator's report of its voice list), WebGPU on a
  real GPU, real speakers and microphones.

## Owner checks

- Deploy, then on the **iPhone** (Safari tab and the installed app): open a recipe → Cook → mise en place → **tap** the
  mic chip. Expect the spinner while the model downloads the first time (~45 MB; on mobile data it can take a minute or
  more) and the **prep list read aloud right away**. It now runs the model on the CPU on iOS; the page should no longer
  reload. If it did crash anyway, the next load shows "Hands-free couldn't start on this device, so it's off." instead
  of looping: tell me.
- On the iPhone, check the **side mute switch**: on some iOS versions it silences `speechSynthesis` (the app can't tell);
  turn it off and the volume up before judging.
- Reload the cook page: the chip is **off** until you tap it (by design now). Moving on to the steps and the review keeps
  it on without another tap.
- **Linux Chromium:** speech needs speech-dispatcher and a voice (espeak-ng) installed system-side (being handled
  separately in `~/dotfiles/nixos`). Without them, expect the red chip and "This device can't read aloud right now.
  Hands-free is still listening." after ~5 s, and "next" / "back" still working. With them, it should pick an English
  voice without "+" (en-CA if there is one) and read; the console should say "No available adapters." once per device
  (then never again: it remembers there's no GPU).
- The "Failed to cache ort-wasm…" console warning can still appear (the library's own copy); the service worker now
  keeps the file, so a second visit shouldn't download it again.

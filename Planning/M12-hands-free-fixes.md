# M12 — Hands-free fixes

Status: in progress

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
- [ ] The engine (imports, microphone, model) starts only from a tap on the toggle. A fresh page load shows the toggle
      off; within the same page session the choice carries across cooking pages (mise en place → steps → review →
      the next cook).
- [ ] PRD R4.31 and spec updated.

### 2. Crash-loop guard (R4.31)
- [ ] `sf.handsFree.starting` (localStorage) is set when the engine starts loading and cleared when it's ready, on a
      clean stop or failure, and on `pagehide`. A page that loads with it set treats the last start as a crash: the flag
      is cleared, the toggle shows its error state, the error toast says hands-free couldn't start on this device, and
      nothing starts.

### 3. Safari unlock (R4.31, R4.33)
- [ ] In the toggle's click (synchronously, before any `await`, in the main bundle) speak a single-space utterance,
      kept referenced until it ends; `speechSynthesis.resume()` when it's paused.

### 4. Speaker robustness (R4.33)
- [ ] `speaker.ts`: cancel only when its own utterances are pending; after a cancel the first `speak()` of the next batch
      waits a macrotask; every utterance kept in an array until `onend`/`onerror`; one wait for `voiceschanged` (1 s
      timeout) before the first read; voice choice as before; `onstart` + a 4 s watchdog on the first utterance of a
      batch; `e.error` mapped (`interrupted`/`canceled` normal; `not-allowed`, `synthesis-unavailable`,
      `synthesis-failed`, `audio-busy`, `language-unavailable`, `voice-unavailable` → unavailable). Sentence splitting
      kept.

### 5. Surface failures (R4.31)
- [ ] Speech unavailable (no API, watchdog with no voices, a failure error): the toggle shows its error state, a toast
      says this device can't read aloud, `console.warn("[hands-free] …")`; listening and commands keep working and the
      setting stays on. Mic/model failures switch it off as before. A TTS failure never calls `fail()`.

### 6. Model path on Safari (R4.34)
- [ ] `stt.worker.ts`: the page tells the worker whether to try WebGPU: never on Safari/iOS (WebKit: WASM q8), never
      when this device already reported no adapter (`sf.handsFree.gpu = "0"`, written when `requestAdapter()` returns
      null). The worker posts `error` when `pipeline()` throws; the page treats a worker `error`/`messageerror` as a
      model failure, also after the model is ready.

### 7. Runtime caching through the service worker
- [ ] Workbox `runtimeCaching`: CacheFirst for `cdn.jsdelivr.net/npm/onnxruntime-web@…/dist/` (few entries, long
      expiry). Hugging Face model files: checked whether `transformers-cache` keeps them; spec §2/§12 notes.

### 8. Tests
- [ ] Unit tests (`apps/web/src/voice/speaker.test.ts`) against a fake `speechSynthesis`: cancel-then-speak ordering
      (the fake drops a speak in the same tick as a cancel, like Chrome), utterances kept until end, empty voice list →
      unavailable, `not-allowed` → unavailable, `interrupted` normal, watchdog.
- [ ] e2e `hands-free.spec.ts`: no auto-start on load; crash-loop guard; speech unavailable while commands still work;
      the existing tests with the new timing. Tags R4.31–R4.34; `pnpm e2e:coverage`.
- [ ] Design pass of the toggle's error state (phone, desktop).

### 9. Documents
- [ ] PRD R4.31–R4.34, spec hands-free section, §2 row, §14.1 row, SETUP.md, `Planning/README.md`, this plan.

## Decisions

## Verification

## Owner checks

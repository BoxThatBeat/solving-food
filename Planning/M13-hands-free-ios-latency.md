# M13 — Hands-free on iOS and command latency

Status: done (owner checks below: iPhone listening after reading, latency, the model; deploy is the owner's)

## Goal

Make hands-free mode keep hearing commands on the iPhone after it has read something aloud, and make a spoken command
act as fast as possible. One report from the owner after testing M12 on an iPhone (2026-10-13), turned into ordered
tasks; decisions taken without the owner (the run was unattended) are recorded under "Decisions".

> "I tried it on safari and found that the voice would read the ingredients but then I could say the command over and
> over "next" and it not work. But eventually I reloaded it and the error showed saying it could not speak this session
> but was still listening and then the commands worked. So it's like iOS didn't allow it to both listen and speak at the
> same time. I also found the wait after saying a command too long (can we reduce that as much as possible)."

**Diagnosis** (from the M12 code and WebKit's audio-session behaviour): when `speechSynthesis` starts playing on iOS, the
audio session changes; WebKit mutes the `getUserMedia` track (`track.muted`, a `mute` event) and/or moves the
`AudioContext` to `"interrupted"`/`"suspended"`. `mic.ts` resumed the context only once, at start, and never looked at
the track again, so after the first read the segmenter got silence for good. With speech unavailable (the M12 error
state) nothing touched the audio session, so listening kept working: exactly what the owner saw. The wait: 1.5 s of
silence, then a Whisper pass that always encodes 30 s of audio (Whisper pads every input), on one WASM thread.

## Requirements covered

R4.32 (changed: on iOS talking over the voice may not work), R4.34 (changed: the silence wait), R4.31 (the "heard"
look of the toggle).

## Items (in build order)

### A. Listening while and after speaking on iOS (R4.32, R4.34)
- [x] `mic.ts`: resume the `AudioContext` on every `statechange` away from `running` while listening is wanted; listen
      to the track's `mute`/`unmute`/`ended`; all logged to the diagnostics (item C).
- [x] After every speech batch ends and after every cancel, nudge the mic: `resume()` the context, and if the track is
      still muted (or the context isn't running) after ~500 ms, re-acquire the microphone (stop the old track,
      `getUserMedia` again, reconnect the worklet) without touching the toggle.
- [x] iOS rule behind a platform check: frames are ignored while the app speaks (the track is kept) and the microphone is
      re-acquired right after each batch ends. Elsewhere the mic keeps listening over the voice.
- [x] Echo filter bound: an entry whose `onend` never fires expires by an estimate of its speaking time (text length,
      capped), so a lost `onend` never blocks commands. Unit test.
- [x] A transcript that is exactly a command word ("next", "next.", "Next!") is never dropped by the echo filter, even
      right after a step containing "next" was read. Unit test.

### B. Command latency (R4.34)
- [x] Timings in the diagnostics: segment duration, silence wait, transcribe time, command applied.
- [x] Silence wait a core constant, about 0.7 s; segments trimmed of leading/trailing silence, capped, and less than
      200 ms of speech ignored (deviation from ~250 ms, see Decisions).
- [x] Decoding options: few new tokens, greedy, no timestamps, no chunking; one warm-up inference after the model loads.
- [x] Benchmark whisper-tiny.en against moonshine-tiny on the WASM path (accuracy of the parsed command, p50/p95
      latency) and switch only if Moonshine is ≥ 2× faster with equal or better accuracy. moonshine-base added to the
      benchmark; it is the one that qualifies and is now the model (see Decisions).
- [x] The toggle shows a brief "heard" look from the moment a segment is sent until its command is applied. No command
      text in the UI.
- [x] No COOP/COEP headers (rejected; see Decisions).

### C. Hidden diagnostics (owner only)
- [x] `?voicedebug=1` (remembered in `localStorage`; `?voicedebug=0` forgets it) shows a small diagnostics sheet on the
      cook pages: the last ~50 events with timestamps, and a Copy button. Lazy chunk, not precached, not in the main
      bundle, nothing in the normal UI.

### D. Tests and documents
- [x] Core unit tests: segmenter timing (new silence constant, trimming, minimum speech), echo-filter bound, single-word
      commands never dropped. Web unit tests: mic recovery with a fake track/context.
- [x] e2e `hands-free.spec.ts`: the "heard" look appears and clears; the diagnostics sheet only with the flag, and Copy.
      Tagged; `pnpm e2e:coverage`.
- [x] Real-model check and benchmark re-run.
- [x] PRD R4.32/R4.34, spec hands-free section, `Planning/README.md`, SETUP.md, this plan.
- [x] Design pass of the "heard" look and the diagnostics sheet (phone, desktop).

## Decisions

- **iOS rule (A.2):** there is no iPhone here, so both fixes ship. Everywhere: the context is resumed on every
  `statechange` and tap, the track is watched, and after each read (and each cancel) the mic is nudged and re-acquired
  if the track is still muted or the context not running after 500 ms. On iOS (`isIOS()`: iPhone/iPad/iPod UA, or a Mac
  UA with touch points, which is iPadOS) listening is **paused while the app speaks** (frames dropped, track kept) and
  the microphone is **re-acquired right after every batch**: iOS mutes the capture during speech anyway, so pausing loses
  little, and a fresh `getUserMedia` is the most reliable way back. Consequence: on iOS, "stop" said over the voice may
  not be heard (tap the toggle, or wait for the read to end); PRD R4.32 says so. Other platforms keep talking over the
  voice. Because this can't be tested here, the hidden diagnostics sheet has a "Listen while reading aloud" choice
  (Auto / Always / Never, `localStorage sf.handsFree.talkOver`) so the owner can try "Always" on the iPhone without a
  redeploy.
- **Re-acquire details:** the old track is stopped before the new `getUserMedia` (one capture at a time); the new
  source is connected to the same worklet; a context that still isn't running after `resume()` is rebuilt (new
  context, worklet and sink). A track muted while the app is silent (a call, another app) gets 1 s, then the same
  (at most once per 3 s). An `ended` track gets one re-acquire; a second end within 3 s or a failing `getUserMedia`
  switches hands-free off as before ("The microphone stopped…"). Any tap or key also resumes the context (M12 did that
  once only).
- **Echo filter bound (A.3):** each sentence's entry expires at the batch start + 1 s (voices wait) + the estimated
  reading time of it and the sentences before it (core `speechDurationMs()`: 1 s + 90 ms a character, ≤ 30 s) + 8 s;
  `onstart` refreshes it, `onend` sets 8 s from then, a cancel cuts every entry to 8 s from then.
- **Command words never dropped (A.4):** one- and two-word transcripts were already kept; added: a transcript made only
  of command words ("Next. Next. Next.") is kept whatever the app said. This matters for the owner's "said next over and
  over": Whisper/Moonshine can join repeated words into one segment, which the 60 % rule used to strip after a step
  containing "next".
- **Silence wait (B.1): 0.7 s** (`SILENCE_MS`). 0.6 s splits "go back… no, next" more often; 0.8 s buys little. A
  split costs nothing for one-word commands and the last keyword still wins in the later half. Trimming keeps 150 ms
  each side of the speech. Cap 10 s (`MAX_SEGMENT_MS`, was 15 s). **Minimum speech 200 ms, not 250 ms:** natural-voice
  "stop"/"mute" clips have ~270 ms of voiced frames, and through the real microphone path one "stop" was lost at
  250 ms; 200 ms is M11's value, and dropped bursts are now logged ("segment ignored").
- **Decoding (B.2):** greedy (`num_beams: 1`, `do_sample: false`), `return_timestamps: false`, no `chunk_length_s`,
  `max_new_tokens` = 5 per second of audio, at least 16, at most 64 (a flat 16 could cut "go back to the previous one, no
  wait, next please" before its last keyword). Warm-up: one pass on 1 s of silence after load (~0.3 s with Moonshine,
  ~4–5 s with Whisper).
- **Model (B.3): Moonshine base replaces Whisper tiny.en.** Benchmark (headless nixpkgs Chromium, WASM q8, one thread,
  M13 decoding options, harness in the session scratchpad): 84 clips from 14 command phrases in 3 natural Piper voices
  (lessac, alan, amy), clean and with pink noise, plus the 48 espeak-ng clips used since M11 (12 phrases × 2 voices ×
  clean/noisy). Accuracy = `parseVoiceCommand(transcript)` equals the phrase's command.

  | Model (q8) | Download | Natural voices (84) | espeak-ng (48) | Total | p50 / p95 inference |
  |---|---|---|---|---|---|
  | whisper-tiny.en (M11–M12, M12 options) | ~41 MB | — | 32 | — | 2.96 s / 3.86 s (espeak) |
  | whisper-tiny.en (M13 options) | ~41 MB | 66 | 32 | 98/132 (74 %) | 3.04 s / 5.67 s (natural), 2.96 s / 3.64 s (espeak) |
  | moonshine-tiny | ~28 MB | 66 | 30 | 96/132 (73 %) | 0.13 s / 0.35 s (natural), 0.23 s / 0.62 s (espeak) |
  | **moonshine-base** | ~63 MB | **74** | **33** | **107/132 (81 %)** | 0.55 s / 1.54 s (natural), 0.28 s / 0.77 s (espeak) |

  The decoding options alone didn't speed Whisper up: its encoder always runs on 30 s of audio, which is the ~3 s.
  Moonshine tiny is ~20× faster but missed two more commands than Whisper, so by the rule it doesn't qualify; Moonshine
  base is ≥ 5× faster **and** more accurate, so it's the model (download ~68 MB with ONNX Runtime's WASM, was ~47 MB; load
  ~11 s from the network here vs ~8 s). WebGPU (non-WebKit with an adapter) uses fp32 encoder + q4 decoder as for
  Whisper (not testable here: no GPU). Owner veto: the owner specified Whisper tiny.en in M11; switching back is the
  `MODEL` constant in `stt.worker.ts`. All models miss some one-word commands in synthetic voices ("stop" → "Tom"/"Top",
  "mute" → "Newt", "unmute" → "A mute"); no fuzzy aliases were added (the grammar is unchanged).
- **Heard look (B.4):** a sound-wave icon (lucide `AudioLines`) replacing the toggle's icon, pulsing only with
  `motion-safe`, `data-heard="true"`, screen-reader description "Heard". It shows from the moment a segment goes to the
  worker until its transcript has been handled (command applied or nothing understood) and every queued segment is
  done; at most 10 s; never while off or loading. No text.
- **No COOP/COEP (B.5):** rejected. `Cross-Origin-Embedder-Policy: require-corp` would block the Firebase Auth popup
  flow and cross-origin images without CORP headers (Storage photos), for a multi-threaded WASM speedup that Moonshine
  makes unnecessary.
- **Diagnostics (C):** `?voicedebug=1` on any cook URL turns it on and remembers it (`localStorage sf.voiceDebug`);
  `?voicedebug=0` forgets it. A scroll icon button next to the toggle opens a "Voice diagnostics" sheet: the last 50
  events (newest last, `HH:MM:SS.mmm` UTC), Copy (the log as text with the user agent; a textarea fallback where the
  clipboard API is refused), Clear, and the listening choice above. `diag.ts` is imported only by the lazy voice chunks;
  `VoiceDiagnostics` is its own chunk and is excluded from the precache. Without the flag nothing is recorded.

## Verification

- `pnpm lint`, `pnpm -r typecheck`: clean. `pnpm test`: core 663/663, web 37/37 (new: `voice/mic.test.ts` 9 tests
  against a fake track, stream and context: segments, resume on statechange and tap, a still-muted track re-acquired
  after a read and not when unmuted, an interrupted context rebuilt, muted-while-idle re-acquire, iOS pause and
  re-acquire after each batch, an ended track's one re-acquire then failure, a failing re-acquire, stop during
  re-acquire; `voice/diag.test.ts` flag and ring buffer; `speaker.test.ts` +2 echo bound; core +segmenter timing,
  trimming, min speech, the 0.7 s constant, `speechDurationMs`, command words never dropped).
- `pnpm e2e:coverage`: M13 3/3 tagged (R4.31, R4.32, R4.34).
- Playwright (`scripts/e2e.sh`, one project per emulator session, 2 workers), `hands-free.spec.ts` now 10 tests (+2:
  the heard look appears and clears and the mic is told when reading starts/ends; the diagnostics only with the flag,
  remembered until `?voicedebug=0`, Copy):
  - desktop-1080p: hands-free, cooking, timers, review, a11y, leftovers: 31 passed, 1 skipped, 2 failed under load
    (hands-free a11y waiting 45 s for the page, the timers push stub) and both passed on the re-run (13/13); every
    `@smoke` test: 19/19.
  - phone-android: hands-free, cooking, timers, review, a11y: first run 28/31 (review sign-in, the timers stub, and the
    new diagnostics test saying "next" before the intro was read: the test now waits for the read like the others);
    re-runs: hands-free + review + timers ×2 31/32 (one M11 test's page load timed out), hands-free + a11y + cooking
    25/25.
  - phone-ios (WebKit): hands-free, cooking, timers, review: 23/23.
- **Real microphone path, end to end** (headless Chromium, the app's `realInput()` through a throwaway harness page on
  the Vite dev server, Chromium's fake microphone fed a 23 s loop of six Piper commands with 2.5 s gaps, WASM, one
  thread, diagnostics on): model ready (Moonshine base) in 9.2 s from the network with a 0.31 s warm-up. After that,
  from the end of speech to the transcript: "Next," 0.86–0.88 s, "Go back." 0.90–0.92 s, "Ingredients please"
  0.99–1.0 s, "Okay next" 0.91 s, "stop" (lessac voice, misheard "Tom," as in the benchmark) 0.85 s, "Go back to the
  previous one, no wait, next please." 1.46–1.52 s; each = 0.72 s silence wait + 0.13–0.8 s inference. M12 on the same
  machine: 1.5 s wait + ~3 s Whisper ≈ 4.5 s. The command is applied in the same task as the transcript.
- Production build: main entry `index-*.js` 297.3 → 297.5 kB (the lazy-chunk preload table); lazy chunks
  `HandsFreeToggle` 7.8 → 10.2 kB (heard look, diag buffer), `engine` 4.4 → 5.2 kB, `input` 4.2 → 7.9 kB (mic
  recovery), new `VoiceDiagnostics` 3.8 kB (not in `sw.js`), `stt.worker` 547 kB (not precached). Precache 107 entries,
  3.47 MB. No `.wasm` in `dist`, no e2e fake, `voicedebug` only in the toggle chunk.
- Design pass (Latte; phone-android 412×915 and desktop 1920×1080, screenshots in the session scratchpad): the heard look
  is the same accent chip with a sound-wave icon (knob right); the diagnostics button is the header's square ✕-style
  chip; the sheet is the prototype's bottom sheet on phones and centred panel on desktop, with mono timestamps, accent
  Copy and radio chips. With the flag on, the phone header title truncates sooner ("Hand…"): accepted, owner-only. The
  prototype has no voice control; this reuses its chip, sheet and token patterns.
- **Not verifiable here:** a real iPhone (whether WebKit mutes the track or interrupts the context, whether the
  re-acquire brings commands back, whether `getUserMedia` re-prompts), real speakers and microphones, real voices
  (the benchmark is synthetic speech), WebGPU with Moonshine, model load time and memory on a phone.

## Owner checks

- Deploy, then on the **iPhone**: open a recipe → Cook → step mode **with `?voicedebug=1` added to the URL** once (e.g.
  `…/recipes/<id>/cook?step=0&voicedebug=1`; it's remembered on that phone). Tap the mic chip. The first start downloads
  the new speech model (~68 MB; Moonshine base instead of Whisper). Let it read the step, wait until it stops, then say
  "next" a few times: each should move on about a second after you stop talking, and the chip shows a pulsing
  sound-wave while it works it out. Also try "ingredients" then (after the read ends) "next".
- On the iPhone, while it reads, "stop" may not be heard (listening pauses during speech there): tap the chip instead.
  Want to try talking over it? In the diagnostics sheet (scroll icon next to the chip) pick "Always", switch hands-free
  off and on, and try "stop" mid-read.
- If commands still don't work after a read: open the diagnostics sheet, tap **Copy** and paste the log to me. The
  useful lines are "track muted", "context state", "mic re-acquired", "segment", "transcribed".
- On any device: is the 0.7 s wait too eager (cuts you off mid-sentence) or still too slow? And is Moonshine as good as
  Whisper with your voice? If not, say so: Whisper tiny.en is one line away.
- To hide the diagnostics again, open a cook page with `?voicedebug=0`.

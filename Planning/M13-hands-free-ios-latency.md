# M13 — Hands-free on iOS and command latency

Status: in progress

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
- [ ] `mic.ts`: resume the `AudioContext` on every `statechange` away from `running` while listening is wanted; listen
      to the track's `mute`/`unmute`/`ended`; all logged to the diagnostics (item C).
- [ ] After every speech batch ends and after every cancel, nudge the mic: `resume()` the context, and if the track is
      still muted (or the context isn't running) after ~500 ms, re-acquire the microphone (stop the old track,
      `getUserMedia` again, reconnect the worklet) without touching the toggle.
- [ ] iOS rule behind a platform check: frames are ignored while the app speaks (the track is kept) and the microphone is
      re-acquired right after each batch ends. Elsewhere the mic keeps listening over the voice.
- [ ] Echo filter bound: an entry whose `onend` never fires expires by an estimate of its speaking time (text length,
      capped), so a lost `onend` never blocks commands. Unit test.
- [ ] A transcript that is exactly a command word ("next", "next.", "Next!") is never dropped by the echo filter, even
      right after a step containing "next" was read. Unit test.

### B. Command latency (R4.34)
- [ ] Timings in the diagnostics: segment duration, silence wait, transcribe time, command applied.
- [ ] Silence wait a core constant, about 0.7 s; segments trimmed of leading/trailing silence, capped, and less than
      ~250 ms of speech ignored.
- [ ] Decoding options: few new tokens, greedy, no timestamps, no chunking; one warm-up inference after the model loads.
- [ ] Benchmark whisper-tiny.en against moonshine-tiny on the WASM path (accuracy of the parsed command, p50/p95
      latency) and switch only if Moonshine is ≥ 2× faster with equal or better accuracy.
- [ ] The toggle shows a brief "heard" look from the moment a segment is sent until its command is applied. No command
      text in the UI.
- [ ] No COOP/COEP headers (rejected; see Decisions).

### C. Hidden diagnostics (owner only)
- [ ] `?voicedebug=1` (remembered in `localStorage`; `?voicedebug=0` forgets it) shows a small diagnostics sheet on the
      cook pages: the last ~50 events with timestamps, and a Copy button. Lazy chunk, not precached, not in the main
      bundle, nothing in the normal UI.

### D. Tests and documents
- [ ] Core unit tests: segmenter timing (new silence constant, trimming, minimum speech), echo-filter bound, single-word
      commands never dropped. Web unit tests: mic recovery with a fake track/context.
- [ ] e2e `hands-free.spec.ts`: the "heard" look appears and clears; the diagnostics sheet only with the flag, and Copy.
      Tagged; `pnpm e2e:coverage`.
- [ ] Real-model check and benchmark re-run.
- [ ] PRD R4.32/R4.34, spec hands-free section, `Planning/README.md`, SETUP.md, this plan.
- [ ] Design pass of the "heard" look and the diagnostics sheet (phone, desktop).

## Decisions

## Verification

## Owner checks

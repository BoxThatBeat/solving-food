// Speech synthesis for hands-free mode (R4.33): the browser's own voices (`SpeechSynthesisUtterance`, lang en-CA), so
// nothing leaves the device. One utterance per sentence (iOS cuts long ones short), `cancel()` silences at once, and
// what was said in the last few seconds is kept for the echo filter (`stripEcho`).
//
// Browser quirks handled here (M12, TECHNICAL_SPECS §12 "Hands-free mode"):
// - Chrome drops an utterance spoken in the same tick as `cancel()`: after a cancel the next batch starts a macrotask
//   later, and `cancel()` is only called when something of ours is still queued.
// - Chrome can garbage-collect an utterance before its `onend` fires: every utterance stays in `live` until it ends.
// - The voice list loads asynchronously: the first read waits once for `voiceschanged` (at most 1 s).
// - A device without voices (Linux Chromium without speech-dispatcher) or a refused `speak()` (Safari without a tap)
//   is silent without an error: a watchdog on the first sentence of each batch reports the speaker unavailable when it
//   neither starts nor fails within 4 s.
import { sentences, speakable } from "@solving-food/core";

const ECHO_MS = 8000;
const VOICES_WAIT_MS = 1000;
export const WATCHDOG_MS = 4000;

/** `SpeechSynthesisErrorEvent.error` values that mean this device can't read aloud (others are a normal end). */
const FAILURES = new Set(["not-allowed", "synthesis-unavailable", "synthesis-failed", "audio-busy", "language-unavailable", "voice-unavailable"]);

export interface SpeakerCallbacks {
  onSpeaking(speaking: boolean): void;
  /** Reading aloud doesn't work on this device; `reason` is for the console. Called once until `reset()`. */
  onUnavailable(reason: string): void;
}

type Synth = Pick<SpeechSynthesis, "speak" | "cancel" | "getVoices"> & Partial<Pick<SpeechSynthesis, "addEventListener" | "removeEventListener">>;
type UtteranceCtor = new (text: string) => SpeechSynthesisUtterance;

export class Speaker {
  private batch = 0;
  /** Our utterances not yet ended, kept referenced so they can't be collected before `onend`. */
  private live: SpeechSynthesisUtterance[] = [];
  /** A `cancel()` was issued since the last `speak()`: the next batch waits a macrotask. */
  private cancelled = false;
  /** A batch is queued or waiting to be (what the toggle shows as speaking). */
  private busy = false;
  private voices: Promise<void> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private unavailable = false;
  private said: Array<{ text: string; until: number }> = [];

  constructor(
    private cb: SpeakerCallbacks,
    private synth: Synth = window.speechSynthesis,
    private Utterance: UtteranceCtor = window.SpeechSynthesisUtterance,
  ) {}

  private waitForVoices(): Promise<void> {
    this.voices ??= new Promise<void>((resolve) => {
      if (this.synth.getVoices().length) return resolve();
      const done = () => {
        clearTimeout(timer);
        this.synth.removeEventListener?.("voiceschanged", done);
        resolve();
      };
      const timer = setTimeout(done, VOICES_WAIT_MS);
      this.synth.addEventListener?.("voiceschanged", done);
    });
    return this.voices;
  }

  private voice(): SpeechSynthesisVoice | undefined {
    const voices = this.synth.getVoices();
    return (
      voices.find((v) => v.lang === "en-CA" || v.lang === "en_CA") ??
      voices.find((v) => v.lang.startsWith("en") && v.localService) ??
      undefined
    );
  }

  private fail(reason: string) {
    if (this.unavailable) return;
    this.unavailable = true;
    this.clearWatchdog();
    this.cancel();
    this.cb.onUnavailable(reason);
  }

  private clearWatchdog() {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  /** Replaces whatever is being read with `texts`, in order. */
  say(texts: string[]) {
    if (this.live.length || this.busy) this.cancel();
    const batch = ++this.batch;
    const lines = texts.flatMap((t) => sentences(speakable(t)));
    if (!lines.length || this.unavailable) return;
    // Recorded now (not when spoken) so the echo filter knows what's coming.
    const entries = lines.map((text) => ({ text, until: Number.POSITIVE_INFINITY }));
    this.said.push(...entries);
    this.busy = true;
    this.cb.onSpeaking(true);
    const afterCancel = this.cancelled;
    void this.waitForVoices().then(() => {
      if (batch !== this.batch) return;
      if (afterCancel) setTimeout(() => this.speak(batch, lines, entries), 0);
      else this.speak(batch, lines, entries);
    });
  }

  private speak(batch: number, lines: string[], entries: Array<{ until: number }>) {
    if (batch !== this.batch || this.unavailable) return;
    this.cancelled = false;
    const voice = this.voice();
    lines.forEach((text, i) => {
      const u = new this.Utterance(text);
      u.lang = "en-CA";
      if (voice) u.voice = voice;
      let started = false;
      const end = () => {
        if (i === 0) this.clearWatchdog();
        const at = this.live.indexOf(u);
        if (at < 0) return; // cancelled: already accounted for
        this.live.splice(at, 1);
        entries[i]!.until = Date.now() + ECHO_MS;
        if (!this.live.length && batch === this.batch && this.busy) {
          this.busy = false;
          this.cb.onSpeaking(false);
        }
      };
      u.onstart = () => {
        started = true;
        if (i === 0) this.clearWatchdog();
      };
      u.onend = () => {
        // Ended without ever starting on a device with no voices: nothing was heard.
        if (i === 0 && !started && this.live.includes(u) && !this.synth.getVoices().length) return this.fail("no voices (the utterance ended without starting)");
        end();
      };
      u.onerror = (e: SpeechSynthesisErrorEvent) => {
        const error = e?.error ?? "unknown";
        if (FAILURES.has(error)) return this.fail(`speech error: ${error}`);
        if (error !== "interrupted" && error !== "canceled") console.warn("[hands-free] speech error", error);
        end();
      };
      this.live.push(u);
      this.synth.speak(u);
    });
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      if (batch !== this.batch) return;
      const voices = this.synth.getVoices().length;
      this.fail(voices ? "speech never started" : "no voices on this device");
    }, WATCHDOG_MS);
  }

  /** Stops talking now (R4.32 "stop", "mute", the toggle). */
  cancel() {
    this.batch++;
    this.clearWatchdog();
    const now = Date.now();
    // What was queued may have been partly heard: keep it for the echo filter a little longer.
    for (const s of this.said) if (s.until === Number.POSITIVE_INFINITY) s.until = now + ECHO_MS;
    if (this.live.length) {
      this.live = [];
      this.synth.cancel();
      this.cancelled = true;
    }
    if (this.busy) {
      this.busy = false;
      this.cb.onSpeaking(false);
    }
  }

  /** Hands-free switched off: forget an earlier failure so the next switch-on tries again. */
  reset() {
    this.cancel();
    this.unavailable = false;
  }

  /** Sentences being read or read in the last few seconds. */
  recent(): string[] {
    const now = Date.now();
    this.said = this.said.filter((s) => s.until > now);
    return this.said.map((s) => s.text);
  }
}

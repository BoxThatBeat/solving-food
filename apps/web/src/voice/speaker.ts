// Speech synthesis for hands-free mode (R4.33): the browser's own voices (`SpeechSynthesisUtterance`, lang en-CA), so
// nothing leaves the device. One utterance per sentence (iOS cuts long ones short), `cancel()` silences at once, and
// what was said in the last few seconds is kept for the echo filter (`stripEcho`).
import { sentences, speakable } from "@solving-food/core";

const ECHO_MS = 8000;

export class Speaker {
  private pending = 0;
  private batch = 0;
  private said: Array<{ text: string; until: number }> = [];

  constructor(private onSpeaking: (speaking: boolean) => void) {}

  private voice(): SpeechSynthesisVoice | undefined {
    const voices = speechSynthesis.getVoices();
    return voices.find((v) => v.lang === "en-CA" || v.lang === "en_CA") ?? voices.find((v) => v.lang.startsWith("en") && v.localService) ?? undefined;
  }

  /** Replaces whatever is being read with `texts`, in order. */
  say(texts: string[]) {
    this.cancel();
    const batch = ++this.batch;
    const voice = this.voice();
    for (const text of texts.flatMap((t) => sentences(speakable(t)))) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-CA";
      if (voice) u.voice = voice;
      const entry = { text, until: Number.POSITIVE_INFINITY };
      const done = () => {
        if (batch !== this.batch) return;
        entry.until = Date.now() + ECHO_MS;
        this.pending = Math.max(0, this.pending - 1);
        if (!this.pending) this.onSpeaking(false);
      };
      u.onend = done;
      u.onerror = done;
      this.pending++;
      this.said.push(entry);
      speechSynthesis.speak(u);
    }
    if (this.pending) this.onSpeaking(true);
  }

  /** Stops talking now (R4.32 "stop", "mute", the toggle). */
  cancel() {
    this.batch++;
    const now = Date.now();
    // What was queued may have been partly heard: keep it for the echo filter a little longer.
    for (const s of this.said) if (s.until === Number.POSITIVE_INFINITY) s.until = now + ECHO_MS;
    speechSynthesis.cancel();
    if (this.pending) this.onSpeaking(false);
    this.pending = 0;
  }

  /** Sentences being read or read in the last few seconds. */
  recent(): string[] {
    const now = Date.now();
    this.said = this.said.filter((s) => s.until > now);
    return this.said.map((s) => s.text);
  }
}

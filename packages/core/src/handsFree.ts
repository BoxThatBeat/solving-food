// Hands-free mode (PRD R4.31–R4.34, TECHNICAL_SPECS §12 "Hands-free mode"): the pure parts. The command grammar, the
// echo filter, the voice activity segmenter, resampling to 16 kHz, and text made speakable. No browser APIs here; the
// web app's `voice/` folder owns the microphone, the model worker and speech synthesis.

export const VOICE_COMMANDS = ["next", "previous", "ingredients", "steps", "stop", "mute", "unmute"] as const;
export type VoiceCommand = (typeof VOICE_COMMANDS)[number];

/** Single-word keywords. "step" and "ingredient" (singular) are deliberately absent: "next step" means next. */
const KEYWORDS: Record<string, VoiceCommand> = {
  next: "next",
  previous: "previous",
  back: "previous",
  before: "previous",
  ingredients: "ingredients",
  steps: "steps",
  instructions: "steps",
  stop: "stop",
  mute: "mute",
  unmute: "unmute",
};

/**
 * Lower-case words of a transcript: punctuation and Whisper's bracketed tags ("[BLANK_AUDIO]", "(music)") removed,
 * apostrophes dropped ("what's" → "whats"), "un-mute" / "un mute" joined into "unmute", "shutup" split.
 */
export function voiceWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, " ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bun mute\b/g, "unmute")
    .replace(/\bshutup\b/g, "shut up")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The command in a transcript (R4.32): whole-word keywords, case and punctuation insensitive; when several are
 * spoken, the last one wins. "shut up" is mute; "unmute" is never read as "mute". `none` when nothing matches.
 */
export function parseVoiceCommand(transcript: string): VoiceCommand | "none" {
  const words = voiceWords(transcript);
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i]!;
    if (w === "up" && words[i - 1] === "shut") return "mute";
    const c = KEYWORDS[w];
    if (c) return c;
  }
  return "none";
}

/**
 * Removes what is probably the app hearing itself (R4.32 talking over the voice). When a transcript of three or more
 * words is mostly (≥ 60 %) words the app spoke recently, those words are dropped and only the rest is kept, so a
 * keyword read out in a step ("Next, add the onions") doesn't act as a command, while one the user says over the voice
 * still does. Short transcripts ("next", "stop talking") are always kept as heard, and so is one made only of command
 * words ("Next. Next. Next.", M13: the owner repeating a command after a step that said "next").
 */
export function stripEcho(transcript: string, recentlySpoken: readonly string[]): string {
  const words = voiceWords(transcript);
  if (words.length < 3 || !recentlySpoken.length) return words.join(" ");
  if (words.every((w, i) => KEYWORDS[w] || (w === "shut" && words[i + 1] === "up") || (w === "up" && words[i - 1] === "shut"))) return words.join(" ");
  const spoken = new Set(recentlySpoken.flatMap(voiceWords));
  const echoed = words.filter((w) => spoken.has(w)).length;
  if (echoed / words.length < 0.6) return words.join(" ");
  return words.filter((w) => !spoken.has(w)).join(" ");
}

/**
 * A generous estimate of how long a speech synthesiser takes to read `text` aloud (M13): 1 s plus 90 ms a character
 * (about 130 words a minute, slower than any default voice), at most 30 s. The echo filter keeps a sentence this long
 * after it was queued or started when its `onend` never comes (seen on iOS and Chrome), so a lost event can't hide the
 * app's words from commands forever.
 */
export function speechDurationMs(text: string): number {
  return Math.min(30_000, 1000 + 90 * text.length);
}

// ---------- audio

export const STT_SAMPLE_RATE = 16_000;

/**
 * Mono PCM resampled from `fromRate` to `toRate` (down only) by averaging the input samples under each output sample:
 * a box low-pass that's plenty for speech recognition. Returns the input when the rates match.
 */
export function downsample(input: Float32Array, fromRate: number, toRate = STT_SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return input;
  if (fromRate < toRate) throw new Error("downsample: only lowers the rate");
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += input[j]!;
    out[i] = b > a ? sum / (b - a) : 0;
  }
  return out;
}

/**
 * Silence that ends an utterance (R4.34). The owner first asked for 1.5 s (M11), then for the wait to be cut as much as
 * possible (M13): 0.7 s still keeps the short pauses inside a sentence ("go back… no, next") in one segment, and a
 * split there only costs the earlier half (the last keyword wins either way).
 */
export const SILENCE_MS = 700;
/** A segment is cut and sent at this length even while speech goes on (commands are short). */
export const MAX_SEGMENT_MS = 10_000;
/**
 * Less voiced audio than this is a click or a clatter, not speech: dropped. 200 ms, not the 250 ms first planned for
 * M13: a clean synthetic "stop" or "mute" has only ~270 ms of voiced frames, and one was lost through a real
 * microphone path at 250.
 */
export const MIN_SPEECH_MS = 200;
/** Quiet audio kept on each side of the speech when a segment is trimmed, so no syllable is clipped. */
const PAD_MS = 150;

export interface SegmenterOptions {
  sampleRate?: number;
  /** Silence that ends a segment (`SILENCE_MS`). */
  silenceMs?: number;
  /** A segment is cut and sent at this length even while speech goes on. */
  maxMs?: number;
  /** Less voiced audio than this is a click or a cough, not speech: dropped. */
  minSpeechMs?: number;
  /** Audio kept from before speech started, so the first syllable isn't clipped. */
  prerollMs?: number;
  /** The quietest level counted as speech (RMS of [-1, 1] samples). */
  minThreshold?: number;
  /** Told about a burst too short to be speech (for the diagnostics). */
  onShort?: (voicedMs: number) => void;
}

/** A finished utterance and what the diagnostics show about it (M13). */
export interface SpeechSegment {
  /** 16 kHz mono PCM, trimmed to the speech plus `PAD_MS` each side. */
  pcm: Float32Array;
  /** Length of `pcm`. */
  ms: number;
  /** Frames counted as speech. */
  voicedMs: number;
  /** Mean level of the voiced frames (RMS). */
  rms: number;
  /** From the last voiced frame to the segment being emitted: the silence wait actually spent. */
  waitedMs: number;
}

const FRAME_MS = 30;

/**
 * An energy-based voice activity detector. Feed it 16 kHz mono PCM in any chunk size; it returns the speech segments
 * that completed: speech followed by `silenceMs` of quiet (`SILENCE_MS`, 0.7 s), or `maxMs` of speech. The threshold
 * follows the room's noise floor (3.5× the quietest frame of the last 3 s, at least `minThreshold`), so a steady hum (a
 * range hood) stops counting as speech after a few seconds, while the gaps between words keep the floor low during
 * speech. Leading and trailing silence beyond 150 ms is trimmed off the segment (M13).
 */
export class SpeechSegmenter {
  private readonly frame: number;
  private readonly silenceFrames: number;
  private readonly maxFrames: number;
  private readonly minVoiced: number;
  private readonly prerollFrames: number;
  private readonly padFrames: number;
  private readonly minThreshold: number;
  private readonly onShort: ((voicedMs: number) => void) | undefined;
  private pending: number[] = [];
  private preroll: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private speaking = false;
  private onset = 0;
  private voiced = 0;
  private silent = 0;
  private voicedRms = 0;
  /** Index in `frames` of the first and last frame counted as speech. */
  private firstLoud = 0;
  private lastLoud = 0;
  /** Recent frame levels (3 s): the noise floor is their minimum, so it follows the room even while someone talks. */
  private levels: number[] = Array.from({ length: 100 }, () => 0.002);

  constructor(opts: SegmenterOptions = {}) {
    const rate = opts.sampleRate ?? STT_SAMPLE_RATE;
    this.frame = Math.round((rate * FRAME_MS) / 1000);
    this.silenceFrames = Math.ceil((opts.silenceMs ?? SILENCE_MS) / FRAME_MS);
    this.maxFrames = Math.ceil((opts.maxMs ?? MAX_SEGMENT_MS) / FRAME_MS);
    this.minVoiced = Math.ceil((opts.minSpeechMs ?? MIN_SPEECH_MS) / FRAME_MS);
    this.prerollFrames = Math.ceil((opts.prerollMs ?? 300) / FRAME_MS);
    this.padFrames = Math.ceil(PAD_MS / FRAME_MS);
    this.minThreshold = opts.minThreshold ?? 0.01;
    this.onShort = opts.onShort;
  }

  /** True while a segment is being collected. */
  get inSpeech(): boolean {
    return this.speaking;
  }

  /** The finished segments' audio. */
  push(chunk: Float32Array): Float32Array[] {
    return this.pushSegments(chunk).map((s) => s.pcm);
  }

  /** The finished segments with their measurements (for the diagnostics). */
  pushSegments(chunk: Float32Array): SpeechSegment[] {
    const out: SpeechSegment[] = [];
    for (let i = 0; i < chunk.length; i++) {
      this.pending.push(chunk[i]!);
      if (this.pending.length === this.frame) {
        const f = Float32Array.from(this.pending);
        this.pending = [];
        const seg = this.onFrame(f);
        if (seg) out.push(seg);
      }
    }
    return out;
  }

  /** Forgets everything collected (the mic stopped, or its frames are being ignored). */
  reset(): void {
    this.pending = [];
    this.preroll = [];
    this.frames = [];
    this.speaking = false;
    this.onset = this.voiced = this.silent = this.voicedRms = 0;
  }

  private onFrame(f: Float32Array): SpeechSegment | null {
    let sum = 0;
    for (let i = 0; i < f.length; i++) sum += f[i]! * f[i]!;
    const rms = Math.sqrt(sum / f.length);
    this.levels.push(rms);
    this.levels.shift();
    const loud = rms > Math.max(this.minThreshold, Math.min(...this.levels) * 3.5);
    if (!this.speaking) {
      this.preroll.push(f);
      if (this.preroll.length > this.prerollFrames + 3) this.preroll.shift();
      this.onset = loud ? this.onset + 1 : 0;
      this.voicedRms = loud ? this.voicedRms + rms : 0;
      if (this.onset >= 3) {
        this.speaking = true;
        this.frames = [...this.preroll];
        this.preroll = [];
        this.voiced = this.onset;
        this.firstLoud = this.frames.length - this.onset;
        this.lastLoud = this.frames.length - 1;
        this.silent = 0;
      }
      return null;
    }
    this.frames.push(f);
    if (loud) {
      this.voiced++;
      this.voicedRms += rms;
      this.silent = 0;
      this.lastLoud = this.frames.length - 1;
    } else this.silent++;
    if (this.silent >= this.silenceFrames || this.frames.length >= this.maxFrames) {
      const from = Math.max(0, this.firstLoud - this.padFrames);
      const to = Math.min(this.frames.length, this.lastLoud + 1 + this.padFrames);
      const pcm = this.voiced >= this.minVoiced ? concat(this.frames.slice(from, to)) : null;
      if (!pcm) this.onShort?.(this.voiced * FRAME_MS);
      const seg = pcm && { pcm, ms: (to - from) * FRAME_MS, voicedMs: this.voiced * FRAME_MS, rms: this.voicedRms / this.voiced, waitedMs: this.silent * FRAME_MS };
      this.speaking = false;
      this.frames = [];
      this.onset = this.voiced = this.silent = this.voicedRms = 0;
      return seg;
    }
    return null;
  }
}

function concat(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let o = 0;
  for (const f of frames) {
    out.set(f, o);
    o += f.length;
  }
  return out;
}

// ---------- speech

const FRACTION_WORDS: Record<string, string> = {
  "½": "a half",
  "⅓": "a third",
  "⅔": "two thirds",
  "¼": "a quarter",
  "¾": "three quarters",
  "⅛": "an eighth",
  "⅜": "three eighths",
  "⅝": "five eighths",
  "⅞": "seven eighths",
};

const UNIT_WORDS: Record<string, [string, string]> = {
  mg: ["milligram", "milligrams"],
  g: ["gram", "grams"],
  kg: ["kilogram", "kilograms"],
  ml: ["millilitre", "millilitres"],
  dl: ["decilitre", "decilitres"],
  l: ["litre", "litres"],
  tsp: ["teaspoon", "teaspoons"],
  tbsp: ["tablespoon", "tablespoons"],
  oz: ["ounce", "ounces"],
  lb: ["pound", "pounds"],
  min: ["minute", "minutes"],
  mins: ["minute", "minutes"],
  hr: ["hour", "hours"],
  hrs: ["hour", "hours"],
};

const FRACTION = "[½⅓⅔¼¾⅛⅜⅝⅞]";
const NUMBER = String.raw`(\d+(?:[.,]\d+)?${FRACTION}?|${FRACTION})`;
const UNIT_AFTER_NUMBER = new RegExp(String.raw`${NUMBER}\s*(mg|kg|g|ml|dl|l|tsp|tbsp|oz|lb|mins?|hrs?)\b\.?`, "gi");

/**
 * Text as it should be read aloud: "600 g" → "600 grams", "2 tbsp" → "2 tablespoons", "1½ cups" → "1 and a half
 * cups", "430°F" → "430 degrees Fahrenheit", "1 (55 g)" → "1, 55 grams".
 */
export function speakable(text: string): string {
  return text
    .replace(UNIT_AFTER_NUMBER, (_m, n: string, u: string) => {
      const words = UNIT_WORDS[u.toLowerCase()]!;
      const one = n === "1" || /^[½⅓¼⅛]$/.test(n);
      return `${n} ${one ? words[0] : words[1]}`;
    })
    .replace(/(\d)\s*(?:°|º|˚)\s*F\b/g, "$1 degrees Fahrenheit")
    .replace(/(\d)([½⅓⅔¼¾⅛⅜⅝⅞])/g, (_m, d: string, f: string) => `${d} and ${FRACTION_WORDS[f]}`)
    .replace(/[½⅓⅔¼¾⅛⅜⅝⅞]/g, (f) => FRACTION_WORDS[f]!)
    .replace(/\s*\(([^)]*)\)/g, ", $1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits text into sentences for speech synthesis (iOS cuts long utterances short). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[a-z0-9]/i.test(s));
}

/** An ingredient line as said aloud: "600 g chicken thigh", "a pinch of salt", "salt, to taste", "bay leaves". */
export function ingredientSpeech(amount: string, name: string): string {
  if (!amount) return name;
  if (amount === "to taste") return `${name}, to taste`;
  if (/^(a|an)\s|\b(pinch|pinches|dash|dashes|splash|splashes|handful|handfuls)$/.test(amount)) return `${amount} of ${name}`;
  return `${amount} ${name}`;
}

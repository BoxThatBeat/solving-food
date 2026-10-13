import { describe, expect, it } from "vitest";
import { downsample, ingredientSpeech, MAX_SEGMENT_MS, MIN_SPEECH_MS, parseVoiceCommand, sentences, SILENCE_MS, speakable, speechDurationMs, SpeechSegmenter, stripEcho, voiceWords } from "./handsFree";

describe("parseVoiceCommand (R4.32)", () => {
  it.each([
    ["next", "next"],
    ["Next!", "next"],
    ["previous", "previous"],
    ["go back", "previous"],
    ["the one before", "previous"],
    ["ingredients", "ingredients"],
    ["What are the ingredients?", "ingredients"],
    ["steps", "steps"],
    ["read the instructions please", "steps"],
    ["STOP.", "stop"],
    ["mute", "mute"],
    ["shut up", "mute"],
    ["Shut up!", "mute"],
    ["shutup", "mute"],
    ["unmute", "unmute"],
    ["Unmute.", "unmute"],
    ["un-mute", "unmute"],
    ["un mute", "unmute"],
  ] as const)("%s → %s", (text, cmd) => {
    expect(parseVoiceCommand(text)).toBe(cmd);
  });

  it("the last keyword spoken wins", () => {
    expect(parseVoiceCommand("go back to the previous one, no wait, next")).toBe("next");
    expect(parseVoiceCommand("next, no, back")).toBe("previous");
    expect(parseVoiceCommand("stop reading the ingredients")).toBe("ingredients");
    expect(parseVoiceCommand("read the ingredients then stop")).toBe("stop");
    expect(parseVoiceCommand("mute, actually unmute")).toBe("unmute");
    expect(parseVoiceCommand("unmute, no, mute")).toBe("mute");
    expect(parseVoiceCommand("ok shut up and go next")).toBe("next");
    expect(parseVoiceCommand("next, shut up")).toBe("mute");
  });

  it("whole words only: unmute is never mute, singular step and ingredient aren't commands", () => {
    expect(parseVoiceCommand("unmute")).not.toBe("mute");
    expect(parseVoiceCommand("next step")).toBe("next");
    expect(parseVoiceCommand("go to the previous step")).toBe("previous");
    expect(parseVoiceCommand("what's the next ingredient")).toBe("next");
    expect(parseVoiceCommand("nextdoor muted stopwatch backing")).toBe("none");
    expect(parseVoiceCommand("instructional")).toBe("none");
  });

  it("empty and garbage transcripts are none", () => {
    for (const t of ["", "   ", "[BLANK_AUDIO]", "(music)", "*coughs*", "Thank you.", "...", "1234", "¿¡"]) expect(parseVoiceCommand(t)).toBe("none");
    expect(parseVoiceCommand("[BLANK_AUDIO] next")).toBe("next");
  });

  it("voiceWords normalises punctuation and apostrophes", () => {
    expect(voiceWords("What's NEXT?! (laughs)")).toEqual(["whats", "next"]);
  });
});

describe("stripEcho (R4.32)", () => {
  const spoken = ["Next, add the onions and cook until soft."];
  it("drops the app's own words from a transcript that is mostly echo", () => {
    expect(parseVoiceCommand(stripEcho("Next add the onions and cook", spoken))).toBe("none");
  });
  it("keeps a command the user says over the voice", () => {
    expect(parseVoiceCommand(stripEcho("add the onions stop", spoken))).toBe("stop");
    expect(parseVoiceCommand(stripEcho("ok go back please", spoken))).toBe("previous");
  });
  it("keeps short transcripts as heard, and everything when nothing was spoken", () => {
    expect(stripEcho("next", spoken)).toBe("next");
    expect(stripEcho("Next add the onions", [])).toBe("next add the onions");
  });
  it("a transcript that is exactly a command word is never dropped, even right after a step that said it (M13)", () => {
    const step = ["Next, stop stirring and go back to the onions; mute the heat. Next, unmute it."];
    for (const t of ["next", "next.", "Next!", " NEXT ", "Next?", "stop", "go back", "unmute.", "Shut up!"]) {
      expect(parseVoiceCommand(stripEcho(t, step))).toBe(parseVoiceCommand(t));
      expect(parseVoiceCommand(stripEcho(t, step))).not.toBe("none");
    }
  });
  it("a command repeated in one breath is kept, however much of it the app said (M13)", () => {
    const step = ["Next, add the onions. Next, stir."];
    expect(parseVoiceCommand(stripEcho("Next. Next. Next.", step))).toBe("next");
    expect(parseVoiceCommand(stripEcho("next next next next", step))).toBe("next");
    expect(parseVoiceCommand(stripEcho("shut up shut up", ["Shut up and stir."]))).toBe("mute");
  });
});

describe("speechDurationMs (M13: the echo filter's bound)", () => {
  it("grows with the text and is capped", () => {
    expect(speechDurationMs("")).toBe(1000);
    expect(speechDurationMs("Dice the onion.")).toBeGreaterThan(1000);
    expect(speechDurationMs("Dice the onion.")).toBeLessThan(3000);
    expect(speechDurationMs("x".repeat(5000))).toBe(30_000);
  });
  it("is slower than a real voice (about 130 words a minute)", () => {
    const text = "Sear the chicken thighs in olive oil for ten minutes, turning once, until golden on both sides.";
    const words = text.split(" ").length;
    expect(speechDurationMs(text)).toBeGreaterThan((words / 160) * 60_000);
  });
});

describe("downsample", () => {
  it("48 kHz → 16 kHz averages each group of three", () => {
    const out = downsample(Float32Array.from([1, 1, 1, 0, 0, 0, 0.5, 0.5, 0.5]), 48_000);
    expect([...out]).toEqual([1, 0, 0.5]);
  });
  it("same rate returns the input; up-sampling is refused", () => {
    const a = new Float32Array(4);
    expect(downsample(a, 16_000)).toBe(a);
    expect(() => downsample(a, 8_000)).toThrow();
  });
  it("44.1 kHz gives the right length", () => {
    expect(downsample(new Float32Array(44_100), 44_100).length).toBe(16_000);
  });
});

describe("SpeechSegmenter (R4.34: 0.7 s of silence since M13)", () => {
  const RATE = 16_000;
  const tone = (ms: number, amp = 0.2) => Float32Array.from({ length: (RATE * ms) / 1000 }, (_, i) => amp * Math.sin(i / 3));
  /** Words: 250 ms of voice, 100 ms gaps (real speech is never a steady tone). */
  const words = (ms: number) => Float32Array.from({ length: (RATE * ms) / 1000 }, (_, i) => (i % 5600 < 4000 ? 0.2 * Math.sin(i / 3) : 0.001));
  const quiet = (ms: number) => Float32Array.from({ length: (RATE * ms) / 1000 }, (_, i) => 0.001 * Math.sin(i));

  it("the constants: 0.7 s of silence, a 10 s cap, 200 ms of speech at least", () => {
    expect(SILENCE_MS).toBeGreaterThanOrEqual(600);
    expect(SILENCE_MS).toBeLessThanOrEqual(800);
    expect(MAX_SEGMENT_MS).toBeLessThanOrEqual(15_000);
    expect(MIN_SPEECH_MS).toBe(200);
  });

  it("emits a segment only after SILENCE_MS of silence", () => {
    const s = new SpeechSegmenter();
    expect(s.push(quiet(500))).toEqual([]);
    expect(s.push(tone(800))).toEqual([]);
    expect(s.inSpeech).toBe(true);
    expect(s.push(quiet(SILENCE_MS - 100))).toEqual([]); // still waiting
    const out = s.pushSegments(quiet(200));
    expect(out).toHaveLength(1);
    expect(out[0]!.waitedMs).toBeGreaterThanOrEqual(SILENCE_MS);
    expect(out[0]!.waitedMs).toBeLessThan(SILENCE_MS + 60);
    expect(s.inSpeech).toBe(false);
  });

  it("trims leading and trailing silence to 150 ms each side", () => {
    const s = new SpeechSegmenter();
    s.push(quiet(1000));
    s.push(tone(800));
    const [seg] = s.pushSegments(quiet(1000));
    expect(seg).toBeDefined();
    // 800 ms of speech + at most 150 ms each side (and a frame of rounding).
    expect(seg!.ms).toBeGreaterThanOrEqual(800);
    expect(seg!.ms).toBeLessThanOrEqual(800 + 300 + 60);
    expect(seg!.pcm.length).toBe((seg!.ms / 1000) * RATE);
    expect(seg!.voicedMs).toBeGreaterThanOrEqual(750);
    expect(seg!.rms).toBeGreaterThan(0.1);
    // The audio starts and ends quiet but the speech itself is all there.
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((n, x) => n + x * x, 0) / a.length);
    expect(rms(seg!.pcm.subarray(0, RATE * 0.1))).toBeLessThan(0.01);
    expect(rms(seg!.pcm.subarray(seg!.pcm.length - RATE * 0.1))).toBeLessThan(0.01);
  });

  it("a pause shorter than SILENCE_MS keeps one segment", () => {
    const s = new SpeechSegmenter();
    s.push(quiet(300));
    s.push(tone(400));
    s.push(quiet(SILENCE_MS - 250));
    s.push(tone(400));
    const out = s.push(quiet(SILENCE_MS + 100));
    expect(out).toHaveLength(1);
    expect((out[0]!.length / RATE) * 1000).toBeGreaterThan(800 + SILENCE_MS - 250);
  });

  it("a longer pause splits two commands", () => {
    const s = new SpeechSegmenter();
    s.push(quiet(300));
    const a = s.push(tone(400));
    const b = s.push(quiet(SILENCE_MS + 100));
    const c = s.push(tone(400));
    const d = s.push(quiet(SILENCE_MS + 100));
    expect([...a, ...b, ...c, ...d]).toHaveLength(2);
  });

  it("cuts long speech at the cap and drops anything under MIN_SPEECH_MS", () => {
    const s = new SpeechSegmenter({ maxMs: 3000 });
    const out = s.push(words(7000));
    expect(out.length).toBe(2);
    const short: number[] = [];
    const c = new SpeechSegmenter({ onShort: (ms) => short.push(ms) });
    expect([...c.push(tone(120)), ...c.push(quiet(2000))]).toEqual([]); // a click
    expect(short).toHaveLength(1);
    expect([...c.push(tone(MIN_SPEECH_MS - 60)), ...c.push(quiet(2000))]).toEqual([]); // a clatter
    expect([...c.push(tone(MIN_SPEECH_MS + 90)), ...c.push(quiet(2000))]).toHaveLength(1); // "next"
  });

  it("the threshold follows a noisy room", () => {
    const s = new SpeechSegmenter();
    const hum = (ms: number) => Float32Array.from({ length: (RATE * ms) / 1000 }, (_, i) => 0.02 * Math.sin(i / 2));
    // A range hood switches on: at most one segment of hum while the floor catches up, then it isn't speech.
    expect(s.push(hum(6000)).length).toBeLessThanOrEqual(1);
    expect(s.inSpeech).toBe(false);
    expect(s.push(hum(20_000))).toEqual([]);
    s.push(tone(500, 0.3));
    expect(s.inSpeech).toBe(true);
  });

  it("reset forgets a segment in progress", () => {
    const s = new SpeechSegmenter();
    s.push(tone(500));
    s.reset();
    expect(s.inSpeech).toBe(false);
    expect(s.push(quiet(2000))).toEqual([]);
  });
});

describe("speakable", () => {
  it.each([
    ["600 g", "600 grams"],
    ["1 kg", "1 kilogram"],
    ["1.8 kg", "1.8 kilograms"],
    ["2 tbsp", "2 tablespoons"],
    ["½ tsp", "a half teaspoon"],
    ["1½ cups", "1 and a half cups"],
    ["250 ml", "250 millilitres"],
    ["1 L", "1 litre"],
    ["Preheat the oven to 430°F.", "Preheat the oven to 430 degrees Fahrenheit."],
    ["2 potatoes (430 g)", "2 potatoes, 430 grams"],
    ["Simmer for 10 min", "Simmer for 10 minutes"],
    ["2 large eggs", "2 large eggs"],
    ["3 garlic cloves", "3 garlic cloves"],
  ])("%s → %s", (a, b) => {
    expect(speakable(a)).toBe(b);
  });
});

describe("sentences", () => {
  it("splits on sentence ends, not decimal points", () => {
    expect(sentences("Add 1.5 kg of flour. Stir! Then rest; cover.")).toEqual(["Add 1.5 kg of flour.", "Stir!", "Then rest;", "cover."]);
    expect(sentences("  ")).toEqual([]);
  });
});

describe("ingredientSpeech", () => {
  it("puts the amount where a cook would say it", () => {
    expect(ingredientSpeech("600 g", "chicken thigh")).toBe("600 g chicken thigh");
    expect(ingredientSpeech("a pinch", "salt")).toBe("a pinch of salt");
    expect(ingredientSpeech("2 pinches", "chili flakes")).toBe("2 pinches of chili flakes");
    expect(ingredientSpeech("to taste", "pepper")).toBe("pepper, to taste");
    expect(ingredientSpeech("", "bay leaves")).toBe("bay leaves");
    expect(speakable(ingredientSpeech("2 tbsp", "olive oil"))).toBe("2 tablespoons olive oil");
  });
});

import { describe, expect, it } from "vitest";
import { downsample, ingredientSpeech, parseVoiceCommand, sentences, speakable, SpeechSegmenter, stripEcho, voiceWords } from "./handsFree";

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

describe("SpeechSegmenter (R4.34: 1.5 s of silence)", () => {
  const RATE = 16_000;
  const tone = (ms: number, amp = 0.2) => Float32Array.from({ length: (RATE * ms) / 1000 }, (_, i) => amp * Math.sin(i / 3));
  /** Words: 250 ms of voice, 100 ms gaps (real speech is never a steady tone). */
  const words = (ms: number) => Float32Array.from({ length: (RATE * ms) / 1000 }, (_, i) => (i % 5600 < 4000 ? 0.2 * Math.sin(i / 3) : 0.001));
  const quiet = (ms: number) => Float32Array.from({ length: (RATE * ms) / 1000 }, (_, i) => 0.001 * Math.sin(i));

  it("emits a segment only after 1.5 s of silence", () => {
    const s = new SpeechSegmenter();
    expect(s.push(quiet(500))).toEqual([]);
    expect(s.push(tone(800))).toEqual([]);
    expect(s.inSpeech).toBe(true);
    expect(s.push(quiet(1400))).toEqual([]); // 1.4 s: still waiting
    const out = s.push(quiet(200));
    expect(out).toHaveLength(1);
    // Preroll + speech + at most 300 ms of trailing silence.
    const ms = (out[0]!.length / RATE) * 1000;
    expect(ms).toBeGreaterThan(800);
    expect(ms).toBeLessThan(800 + 300 + 400);
    expect(s.inSpeech).toBe(false);
  });

  it("a pause shorter than 1.5 s keeps one segment", () => {
    const s = new SpeechSegmenter();
    s.push(quiet(300));
    s.push(tone(400));
    s.push(quiet(1000));
    s.push(tone(400));
    const out = s.push(quiet(1600));
    expect(out).toHaveLength(1);
    expect((out[0]!.length / RATE) * 1000).toBeGreaterThan(1800);
  });

  it("cuts long speech at the cap and drops clicks", () => {
    const s = new SpeechSegmenter({ maxMs: 3000 });
    const out = s.push(words(7000));
    expect(out.length).toBe(2);
    const c = new SpeechSegmenter();
    expect([...c.push(tone(120)), ...c.push(quiet(2000))]).toEqual([]); // 120 ms: under minSpeechMs
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

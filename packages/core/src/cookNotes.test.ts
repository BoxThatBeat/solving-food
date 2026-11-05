// Cook notes (M28, R4.38, R4.39, R9.6): the latest notes per recipe, step notes carried forward, what a cook sends.
import { describe, expect, it } from "vitest";
import { latestStepNotes, notedRecipeIds, recipeNotes, stepNotesToSend, type NotedEvent } from "./cookNotes";

const DAY = 86_400_000;
const ev = (id: string, day: number, over: Partial<NotedEvent> = {}): NotedEvent => ({ id, cookedAtMs: day * DAY, cookedBy: "u1", recipeIds: ["r"], ...over });

describe("recipeNotes", () => {
  const events = [
    ev("a", 1, { note: "Too salty" }),
    ev("b", 5, { note: "  More lemon next time  ", cookedBy: "u2" }),
    ev("c", 7),
    ev("d", 9, { note: "Other recipe", recipeIds: ["s"] }),
    ev("e", 3, { note: "   " }),
    ev("f", 4, { note: "Meal note", recipeIds: ["s", "r"] }),
  ];
  it("lists a recipe's notes newest first, with when and who", () => {
    expect(recipeNotes(events, "r")).toEqual([
      { eventId: "b", cookedAtMs: 5 * DAY, cookedBy: "u2", text: "More lemon next time" },
      { eventId: "f", cookedAtMs: 4 * DAY, cookedBy: "u1", text: "Meal note" },
      { eventId: "a", cookedAtMs: 1 * DAY, cookedBy: "u1", text: "Too salty" },
    ]);
  });
  it("leaves out the event being reviewed and stops at the limit", () => {
    expect(recipeNotes(events, "r", { exclude: "b" }).map((n) => n.eventId)).toEqual(["f", "a"]);
    expect(recipeNotes(events, "r", { max: 1 }).map((n) => n.eventId)).toEqual(["b"]);
  });
});

describe("latestStepNotes", () => {
  it("takes the newest event with step notes for the recipe; cleared notes don't show", () => {
    const events = [
      ev("a", 1, { stepNotes: [{ recipeId: "r", step: 0, text: "Old" }, { recipeId: "r", step: 2, text: "Hotter pan" }] }),
      ev("b", 2, { stepNotes: [{ recipeId: "r", step: 2, text: "Hotter pan" }, { recipeId: "r", step: 0, text: "" }] }),
      ev("c", 3, { note: "no step notes" }),
      ev("d", 4, { stepNotes: [{ recipeId: "s", step: 1, text: "Another recipe" }] }),
    ];
    expect([...latestStepNotes(events, "r")]).toEqual([[2, "Hotter pan"]]);
    expect([...latestStepNotes(events, "r", "b")]).toEqual([[0, "Old"], [2, "Hotter pan"]]);
    expect(latestStepNotes([], "r").size).toBe(0);
  });
});

describe("stepNotesToSend", () => {
  it("carries the shown notes forward with this cook's edits on top", () => {
    const shown = new Map([[0, "Old"], [2, "Hotter pan"]]);
    const edits = new Map([[0, ""], [4, " Rest 5 min "], [5, ""]]);
    expect(stepNotesToSend("r", shown, edits)).toEqual([
      { recipeId: "r", step: 0, text: "" },
      { recipeId: "r", step: 2, text: "Hotter pan" },
      { recipeId: "r", step: 4, text: "Rest 5 min" },
    ]);
  });
  it("sends nothing when there was nothing to show or edit", () => {
    expect(stepNotesToSend("r", new Map(), new Map())).toEqual([]);
    expect(stepNotesToSend("r", new Map(), new Map([[1, " "]]))).toEqual([]);
  });
  it("caps a note's length", () => {
    expect(stepNotesToSend("r", new Map(), new Map([[0, "x".repeat(300)]]))[0]!.text).toHaveLength(200);
  });
});

describe("notedRecipeIds", () => {
  it("is every recipe for a review note, else those with step notes", () => {
    expect(notedRecipeIds(["b", "a"], "Good")).toEqual(["a", "b"]);
    expect(notedRecipeIds(["a", "b"], "  ", [{ recipeId: "b", step: 0, text: "" }])).toEqual(["b"]);
    expect(notedRecipeIds(["a"], undefined, [{ recipeId: "zzz", step: 0, text: "x" }])).toEqual([]);
  });
});

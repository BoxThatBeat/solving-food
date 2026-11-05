// Cook notes (M28, PRD R4.38, R4.39, R9.6; TECHNICAL_SPECS §4.2 cookEvents, §12 "Cook notes"). The review's "notes for
// next time" and per-step notes live on cook events (function-written, through the finishCooking and submitReview
// commands). These pick what the next cook sees: the latest notes for a recipe, with when and by whom, and the step
// notes that apply now. Events come from one bounded query (`notedRecipeIds` array-contains the recipe, newest 5).

/** How many earlier notes "Show earlier" can open (the query's limit). */
export const COOK_NOTES_SHOWN = 5;
/** A step note's length and how many one cook event can carry (a meal of several recipes). */
export const STEP_NOTE_MAX = 200;
export const STEP_NOTES_MAX = 60;

/** One step's note: the recipe, the step's index (0-based), and its text ("" = the note was cleared). */
export interface StepNote {
  recipeId: string;
  step: number;
  text: string;
}

export interface NotedEvent {
  id: string;
  cookedAtMs: number;
  cookedBy: string;
  recipeIds: readonly string[];
  note?: string | undefined;
  stepNotes?: readonly StepNote[] | undefined;
}

export interface CookNote {
  eventId: string;
  cookedAtMs: number;
  cookedBy: string;
  text: string;
}

/**
 * The review notes left for a recipe, newest first (R4.38): events that cooked it with a non-empty note, `exclude` (the
 * event being reviewed) left out, at most `max`.
 */
export function recipeNotes(events: readonly NotedEvent[], recipeId: string, opts: { exclude?: string | undefined; max?: number } = {}): CookNote[] {
  return events
    .filter((e) => e.id !== opts.exclude && e.recipeIds.includes(recipeId) && !!e.note?.trim())
    .sort((a, b) => b.cookedAtMs - a.cookedAtMs || a.id.localeCompare(b.id))
    .slice(0, opts.max ?? COOK_NOTES_SHOWN)
    .map((e) => ({ eventId: e.id, cookedAtMs: e.cookedAtMs, cookedBy: e.cookedBy, text: e.note!.trim() }));
}

/**
 * The step notes that apply to a recipe now (R4.39): those of the newest event carrying any step note for it (each cook
 * carries the notes forward, so the newest set is the whole set), cleared ones ("") left out. Step index → text.
 */
export function latestStepNotes(events: readonly NotedEvent[], recipeId: string, exclude?: string): Map<number, string> {
  const newest = [...events]
    .filter((e) => e.id !== exclude && (e.stepNotes ?? []).some((n) => n.recipeId === recipeId))
    .sort((a, b) => b.cookedAtMs - a.cookedAtMs || a.id.localeCompare(b.id))[0];
  const out = new Map<number, string>();
  for (const n of newest?.stepNotes ?? []) if (n.recipeId === recipeId && n.text.trim()) out.set(n.step, n.text.trim());
  return out;
}

/**
 * The step notes a cook sends with Done cooking (R4.39): the notes it showed (`shown`, carried forward) with this cook's
 * edits on top; an edit to "" clears a note and is sent as "" so it stays cleared. Nothing when there was nothing to
 * show and nothing was edited (so an earlier cook's notes aren't hidden by an empty set). Sorted by step.
 */
export function stepNotesToSend(recipeId: string, shown: ReadonlyMap<number, string>, edits: ReadonlyMap<number, string>): StepNote[] {
  const steps = new Set([...shown.keys(), ...edits.keys()]);
  const out: StepNote[] = [];
  for (const step of [...steps].sort((a, b) => a - b)) {
    const text = (edits.has(step) ? edits.get(step)! : shown.get(step)!).trim().slice(0, STEP_NOTE_MAX);
    if (!text && !shown.has(step)) continue;
    out.push({ recipeId, step, text });
  }
  return out;
}

/** The recipes a cook event has notes for (`notedRecipeIds`, what the bounded query reads): all of them when it has a
 * review note, else the ones with step notes. */
export function notedRecipeIds(recipeIds: readonly string[], note: string | undefined, stepNotes: readonly StepNote[] = []): string[] {
  const ids = new Set<string>(note?.trim() ? recipeIds : []);
  for (const n of stepNotes) if (recipeIds.includes(n.recipeId)) ids.add(n.recipeId);
  return [...ids].sort();
}

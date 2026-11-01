// The LLM ingredient judge's callables (PRD R4.27, R4.36; TECHNICAL_SPECS §9 "LLM judge"):
//
// aiStatus({ hid })                 members: whether Gemini is set up, how many names are unsure; the owner also gets
//                                   canEditKey and the key's hint
// aiSetKey({ hid, apiKey })         owner only: saves the Gemini key ("" clears it) and tries it with one name
// checkIngredientNames({ hid })     owner only: judges the names waiting (unsure, or flagged before M15) and merges the
//                                   ones Gemini is sure about into the ingredient they mean (moves Supply, R8.16)
import { FieldValue } from "firebase-admin/firestore";
import { buildIngredientIndex, judgeItems, pcxKeyHint, pcxKeyInput, PCX_KEY_PATTERN, type IngredientDoc, type PcxStatus } from "@solving-food/core";
import { db } from "../admin";
import { mergeIngredient, MergeError } from "../ingredients";
import { isOwner } from "../owner";
import { CallError, parse, rateLimit, requireMember } from "../pcx";
import { AI_CONFIG_DOC, AI_NOT_SET_UP, AiError, geminiReady, judgeWithGemini, storedGeminiKey } from "./gemini";

/** Names per Check names call: each merge rewrites recipes and households, so a few dozen fit the 5-minute limit. */
export const CHECK_PER_CALL = 40;

export interface AiStatus extends PcxStatus {
  /** Household-made names nobody has decided yet (R4.35). */
  waiting: number;
}

export { isNameWaiting as isWaiting } from "@solving-food/core";
import { isNameWaiting as isWaiting } from "@solving-food/core";

async function allIngredients(): Promise<Map<string, IngredientDoc>> {
  const snap = await db.collection("ingredients").get();
  return new Map(snap.docs.map((d) => [d.id, d.data() as IngredientDoc]));
}

export async function aiStatus(uid: string, data: unknown, ownerUid: string | null = null): Promise<AiStatus> {
  const hid = String((data as { hid?: unknown })?.hid ?? "");
  await requireMember(uid, hid);
  const owner = await isOwner(uid, hid, ownerUid);
  const key = owner ? await storedGeminiKey() : "";
  const waiting = (await db.collection("ingredients").where("createdBy", "!=", null).get()).docs.filter((d) => isWaiting(d.data() as IngredientDoc)).length;
  const extra = owner ? { canEditKey: true, ...(key ? { keyHint: pcxKeyHint(key) } : {}) } : {};
  return (await geminiReady()) ? { connected: true, waiting, ...extra } : { connected: false, message: AI_NOT_SET_UP, waiting, ...extra };
}

export async function aiSetKey(uid: string, data: unknown, ownerUid: string | null = null): Promise<PcxStatus> {
  const input = parse(pcxKeyInput, data);
  if (!PCX_KEY_PATTERN.test(input.apiKey)) throw new CallError("invalid-argument", "That doesn't look like a Gemini API key: paste only the key (letters, digits, - and _)");
  await requireMember(uid, input.hid);
  if (!(await isOwner(uid, input.hid, ownerUid))) throw new CallError("permission-denied", "Only the app's owner can change the Gemini key");
  await rateLimit(uid);
  const doc = db.doc(AI_CONFIG_DOC);
  if (!input.apiKey) {
    await doc.set({ apiKey: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(), updatedBy: uid }, { merge: true });
    return { connected: false, message: AI_NOT_SET_UP, canEditKey: true };
  }
  await doc.set({ apiKey: input.apiKey, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid }, { merge: true });
  const saved = { canEditKey: true, keyHint: pcxKeyHint(input.apiKey) };
  try {
    await judgeWithGemini([{ name: "test", candidates: [] }], input.apiKey);
    return { connected: true, ...saved };
  } catch (e) {
    return { connected: false, message: `Saved, but Gemini didn't accept it: ${(e as Error).message}`, ...saved };
  }
}

export interface CheckReport {
  checked: number;
  merged: Array<{ from: string; into: string }>;
  kept: string[];
  unsure: string[];
  /** Still waiting after this call (more than CHECK_PER_CALL were waiting). */
  remaining: number;
  message?: string;
}

/** The ingredient `id` ends up as, following merges made earlier in the same run. */
function finalId(id: string, docs: Map<string, IngredientDoc>): string {
  let cur = id;
  for (let n = 0; n < 10 && docs.get(cur)?.mergedInto; n++) cur = docs.get(cur)!.mergedInto!;
  return cur;
}

export async function checkIngredientNames(uid: string, data: unknown, ownerUid: string | null = null): Promise<CheckReport> {
  const hid = String((data as { hid?: unknown })?.hid ?? "");
  await requireMember(uid, hid);
  if (!(await isOwner(uid, hid, ownerUid))) throw new CallError("permission-denied", "Only the app's owner can check names");
  const docs = await allIngredients();
  const waiting = [...docs].filter(([, d]) => isWaiting(d));
  const now = waiting.slice(0, CHECK_PER_CALL);
  const report: CheckReport = { checked: 0, merged: [], kept: [], unsure: [], remaining: waiting.length - now.length };
  if (!now.length) return report;

  const index = buildIngredientIndex([...docs].map(([id, d]) => ({ id, name: d.name, aliases: d.aliases ?? [], mergedInto: d.mergedInto ?? null, needsReview: d.needsReview, category: d.category })));
  const items = judgeItems(
    now.map(([id, d]) => ({ name: d.name, exclude: [id] })),
    index,
    (id) => docs.get(id),
  );
  let verdicts;
  try {
    verdicts = await judgeWithGemini(items);
  } catch (e) {
    if (e instanceof AiError) return { ...report, remaining: waiting.length, message: e.message };
    throw e;
  }

  for (const [id, d] of now) {
    report.checked++;
    const v = verdicts.get(d.name) ?? { verdict: "unsure" as const };
    const ref = db.doc(`ingredients/${id}`);
    if (v.verdict === "same") {
      const into = finalId(v.id, docs);
      try {
        if (into === id) throw new MergeError("invalid-argument", "same ingredient");
        await mergeIngredient(uid, { fromId: id, intoId: into });
        docs.set(id, { ...d, mergedInto: into });
        report.merged.push({ from: d.name, into: docs.get(into)?.name ?? into });
        continue;
      } catch (e) {
        if (!(e instanceof MergeError)) throw e;
        // Refused (e.g. counted vs weighed with no unit weight): it waits for a person.
      }
    }
    if (v.verdict === "new") {
      await ref.update({ nameCheck: "new", updatedAt: FieldValue.serverTimestamp() });
      report.kept.push(d.name);
    } else {
      await ref.update({ nameCheck: "unsure", updatedAt: FieldValue.serverTimestamp() });
      report.unsure.push(d.name);
    }
  }
  return report;
}

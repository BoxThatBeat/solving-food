// Household data download & import (TECHNICAL_SPECS §13, PRD R11.10). Firebase-free: the browser builds the export
// from the documents it read, and the importHousehold function validates and remaps it before writing.
//
// The zip holds:
//   household.json            the versioned export (this schema): household settings and every household collection,
//                             supply with its transactions, and the list of referenced recipes
//   meals.json                the saved meals the household references (global library)
//   recipes/<slug>-<id>.cook  each referenced recipe as Cooklang, so a missing one can be recreated (M1 pipeline)
//
// Timestamps are stored as { "__ts": <epoch ms> } so they round-trip through JSON. Members, invites, commands and the
// per-user collections (users/*/devices, users/*/timers) are never part of an export.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import { cooklangFilename, recipeToCooklang } from "./cooklang";
import type { RecipeContent } from "./recipe";
import { ratingId, statsId } from "./commands";

export const EXPORT_SCHEMA = "solving-food/household";
export const EXPORT_VERSION = 1;
/** Uploads above this are refused by the Storage rules (§10) and the client. */
export const EXPORT_MAX_ZIP_BYTES = 20 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 200 * 1024 * 1024;

/** Household collections copied as plain documents. `supply` (with transactions) is handled on its own. */
export const EXPORT_COLLECTIONS = [
  "stores",
  "sourcingRules",
  "brandMappings",
  "favourites",
  "notes",
  "stats",
  "periods",
  "planItems",
  "groceryLists",
  "cookEvents",
  "ratings",
  "cadence",
] as const;
export type ExportCollection = (typeof EXPORT_COLLECTIONS)[number];

/** Household subcollections an import leaves alone (members aren't changed by an import, R11.10). */
export const IMPORT_KEEPS = ["members", "invites"] as const;

/** Household document fields that come from the export. Name, creator and creation date stay the importer's. */
export const EXPORT_HOUSEHOLD_FIELDS = [
  "periodDays",
  "budgetCents",
  "currency",
  "timezone",
  "defaultServings",
  "plannedMealTypes",
  "pcxStoreId",
  "pcxStoreName",
  "defaultStoreId",
  "currentPeriodId",
  "settings",
] as const;

// ---------- value encoding

export type Encoded = null | boolean | number | string | Encoded[] | { [k: string]: Encoded };

function isTimestampLike(v: unknown): v is { toMillis(): number } {
  return typeof v === "object" && v !== null && typeof (v as { toMillis?: unknown }).toMillis === "function";
}

/** Firestore data → JSON-safe data. Timestamps (anything with toMillis) and Dates become { __ts: ms }. */
export function encodeValue(v: unknown): Encoded {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return { __ts: v.getTime() };
  if (isTimestampLike(v)) return { __ts: v.toMillis() };
  if (Array.isArray(v)) return v.map(encodeValue);
  if (typeof v === "object") {
    const out: Record<string, Encoded> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) out[k] = encodeValue(x);
    return out;
  }
  return null;
}

/** The inverse of `encodeValue`: `{ __ts }` objects become whatever `toTimestamp` makes (a Firestore Timestamp). */
export function decodeValue<T>(v: unknown, toTimestamp: (ms: number) => T): unknown {
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, toTimestamp));
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === "__ts" && typeof o.__ts === "number") return toTimestamp(o.__ts);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) out[k] = decodeValue(x, toTimestamp);
    return out;
  }
  return v;
}

/** Epoch ms of an encoded or live timestamp (or a number), else null. */
export function encodedMs(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && typeof (v as { __ts?: unknown }).__ts === "number") return (v as { __ts: number }).__ts;
  if (v instanceof Date) return v.getTime();
  if (isTimestampLike(v)) return v.toMillis();
  return null;
}

// ---------- schema

/** Firestore document IDs: no slashes, not "." or "..", not __reserved__, at most 1500 bytes. */
export const docIdSchema = z
  .string()
  .min(1)
  .max(1500)
  .refine((s) => !s.includes("/") && s !== "." && s !== ".." && !/^__.*__$/.test(s), "isn't a valid document ID");

const dataSchema = z.record(z.string(), z.unknown());
export const exportDocSchema = z.object({ id: docIdSchema, data: dataSchema });
export type ExportDoc = z.infer<typeof exportDocSchema>;

const lotSchema = z.looseObject({ lotId: z.string().min(1), amount: z.number().min(0) });
export const supplyExportSchema = z.object({
  id: docIdSchema,
  data: z.looseObject({
    label: z.string(),
    canonicalUnit: z.enum(["g", "count"]),
    canonicalAmount: z.number(),
    lots: z.array(lotSchema),
  }),
  transactions: z.array(
    z.object({ id: docIdSchema, data: z.looseObject({ delta: z.number(), kind: z.string(), lotId: z.string() }) }),
  ),
});
export type SupplyExport = z.infer<typeof supplyExportSchema>;

export const exportRecipeSchema = z.object({
  id: docIdSchema,
  title: z.string().min(1).max(200),
  fingerprint: z.string().max(40).nullable(),
  /** Path of the .cook file inside the zip. */
  file: z.string().min(1).max(300),
});
export type ExportRecipe = z.infer<typeof exportRecipeSchema>;

export const exportMealSchema = z.object({
  id: docIdSchema,
  name: z.string().min(1).max(80),
  recipes: z.array(z.object({ recipeId: docIdSchema, servingsMultiplier: z.number().positive() })).min(1).max(12),
});
export type ExportMeal = z.infer<typeof exportMealSchema>;

const collectionsShape = Object.fromEntries(EXPORT_COLLECTIONS.map((c) => [c, z.array(exportDocSchema).default([])])) as {
  [K in ExportCollection]: z.ZodDefault<z.ZodArray<typeof exportDocSchema>>;
};

export const householdExportSchema = z.object({
  schema: z.literal(EXPORT_SCHEMA),
  version: z.number().int().min(1).max(EXPORT_VERSION, "was made by a newer version of Solving Food"),
  exportedAt: z.number().int().positive(),
  household: z.object({ id: docIdSchema, name: z.string().min(1).max(60), fields: dataSchema }),
  collections: z.object(collectionsShape),
  supply: z.array(supplyExportSchema).default([]),
  recipes: z.array(exportRecipeSchema).default([]),
});
export type HouseholdExport = z.infer<typeof householdExportSchema>;

export class ExportError extends Error {}

function zodText(e: z.ZodError): string {
  const i = e.issues[0];
  if (!i) return "isn't valid";
  const path = i.path.map(String).join(".");
  return path ? `${path}: ${i.message}` : i.message;
}

// ---------- building

export interface ExportInput {
  household: { id: string; data: Record<string, unknown> };
  collections: Partial<Record<ExportCollection, Array<{ id: string; data: Record<string, unknown> }>>>;
  supply: Array<{ id: string; data: Record<string, unknown>; transactions: Array<{ id: string; data: Record<string, unknown> }> }>;
  /** Referenced recipes with their Cooklang text (from `recipeToCooklang`). */
  recipes: Array<{ id: string; title: string; fingerprint?: string | null; cook: string }>;
  meals: ExportMeal[];
  nowMs: number;
}

const encDoc = (d: { id: string; data: Record<string, unknown> }): ExportDoc => ({ id: d.id, data: encodeValue(d.data) as Record<string, unknown> });

/** The recipe's file name inside the zip: `recipes/<slug>-<id>.cook` (unique even when titles repeat). */
export function recipeFilePath(title: string, id: string): string {
  const base = cooklangFilename(title).replace(/\.cook$/i, "");
  return `recipes/${base}-${id}.cook`;
}

/** Builds the export from documents already read from Firestore. */
export function buildExport(input: ExportInput): { export: HouseholdExport; meals: ExportMeal[]; cook: Map<string, string> } {
  const fields: Record<string, unknown> = {};
  for (const k of EXPORT_HOUSEHOLD_FIELDS) if (input.household.data[k] !== undefined) fields[k] = input.household.data[k];
  const cook = new Map<string, string>();
  const recipes: ExportRecipe[] = input.recipes.map((r) => {
    const file = recipeFilePath(r.title, r.id);
    cook.set(file, r.cook);
    return { id: r.id, title: r.title, fingerprint: r.fingerprint ?? null, file };
  });
  const collections = Object.fromEntries(EXPORT_COLLECTIONS.map((c) => [c, (input.collections[c] ?? []).map(encDoc)])) as HouseholdExport["collections"];
  const exp: HouseholdExport = {
    schema: EXPORT_SCHEMA,
    version: EXPORT_VERSION,
    exportedAt: input.nowMs,
    household: { id: input.household.id, name: String(input.household.data.name ?? "Household"), fields: encodeValue(fields) as Record<string, unknown> },
    collections,
    supply: input.supply.map((s) => ({
      id: s.id,
      data: encodeValue(s.data) as SupplyExport["data"],
      transactions: s.transactions.map(encDoc) as SupplyExport["transactions"],
    })),
    recipes,
  };
  return { export: exp, meals: input.meals, cook };
}

/** `solving-food-<household>-<yyyy-mm-dd>.zip` */
export function exportFileName(householdName: string, nowMs: number, timeZone = "America/Toronto"): string {
  const slug =
    householdName
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "household";
  const date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(nowMs);
  return `solving-food-${slug}-${date}.zip`;
}

export function zipExport(built: { export: HouseholdExport; meals: ExportMeal[]; cook: Map<string, string> }): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "household.json": strToU8(JSON.stringify(built.export, null, 1)),
    "meals.json": strToU8(JSON.stringify(built.meals, null, 1)),
  };
  for (const [path, text] of built.cook) files[path] = strToU8(text);
  return zipSync(files, { level: 6 });
}

// ---------- reading

export interface ParsedExport {
  export: HouseholdExport;
  meals: ExportMeal[];
  /** zip path → Cooklang text */
  cook: Map<string, string>;
}

/** Unzips and validates an export. Throws ExportError with a sentence the person can act on. */
export function readExportZip(bytes: Uint8Array): ParsedExport {
  if (bytes.byteLength > EXPORT_MAX_ZIP_BYTES) throw new ExportError("That file is larger than 20 MB.");
  let files: Record<string, Uint8Array>;
  try {
    let total = 0;
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new ExportError("That file unpacks to more than 200 MB.");
        return f.name === "household.json" || f.name === "meals.json" || (f.name.startsWith("recipes/") && f.name.endsWith(".cook"));
      },
    });
  } catch (e) {
    if (e instanceof ExportError) throw e;
    throw new ExportError("That isn't a Solving Food export (not a zip file).");
  }
  const hh = files["household.json"];
  if (!hh) throw new ExportError("That isn't a Solving Food export (household.json is missing).");
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(hh));
  } catch {
    throw new ExportError("household.json in that file isn't valid JSON.");
  }
  if (!raw || typeof raw !== "object" || (raw as { schema?: unknown }).schema !== EXPORT_SCHEMA) {
    throw new ExportError("That isn't a Solving Food household export.");
  }
  const parsed = householdExportSchema.safeParse(raw);
  if (!parsed.success) throw new ExportError(`household.json ${zodText(parsed.error)}`);
  let meals: ExportMeal[] = [];
  const mj = files["meals.json"];
  if (mj) {
    let m: unknown;
    try {
      m = JSON.parse(strFromU8(mj));
    } catch {
      throw new ExportError("meals.json in that file isn't valid JSON.");
    }
    const pm = z.array(exportMealSchema).safeParse(m);
    if (!pm.success) throw new ExportError(`meals.json ${zodText(pm.error)}`);
    meals = pm.data;
  }
  const cook = new Map<string, string>();
  for (const [name, data] of Object.entries(files)) if (name.startsWith("recipes/")) cook.set(name, strFromU8(data));
  return { export: parsed.data, meals, cook };
}

// ---------- summary

export interface ExportSummary {
  householdName: string;
  exportedAt: number;
  version: number;
  counts: Record<ExportCollection | "supply" | "transactions" | "recipes" | "meals", number>;
  /** Documents an import writes (household doc included). */
  documents: number;
}

export function exportSummary(p: Pick<ParsedExport, "export" | "meals">): ExportSummary {
  const e = p.export;
  const counts = Object.fromEntries(EXPORT_COLLECTIONS.map((c) => [c, e.collections[c].length])) as ExportSummary["counts"];
  counts.supply = e.supply.length;
  counts.transactions = e.supply.reduce((s, x) => s + x.transactions.length, 0);
  counts.recipes = e.recipes.length;
  counts.meals = p.meals.length;
  const documents = 1 + EXPORT_COLLECTIONS.reduce((s, c) => s + counts[c], 0) + counts.supply + counts.transactions;
  return { householdName: e.household.name, exportedAt: e.exportedAt, version: e.version, counts, documents };
}

// ---------- references and remapping

/** Recipe and saved-meal IDs the household's documents point at (what an export must carry). */
export function referencedIds(collections: Partial<Record<ExportCollection, Array<{ id: string; data: Record<string, unknown> }>>>): {
  recipeIds: Set<string>;
  mealIds: Set<string>;
} {
  const recipeIds = new Set<string>();
  const mealIds = new Set<string>();
  const addRecipe = (v: unknown) => typeof v === "string" && v && recipeIds.add(v);
  const addMeal = (v: unknown) => typeof v === "string" && v && mealIds.add(v);
  for (const d of collections.planItems ?? []) {
    for (const r of (d.data.recipes as Array<{ recipeId?: unknown }> | undefined) ?? []) addRecipe(r?.recipeId);
    addMeal(d.data.savedMealId);
  }
  for (const d of collections.cookEvents ?? []) {
    for (const r of (d.data.recipeIds as unknown[] | undefined) ?? []) addRecipe(r);
    addMeal(d.data.savedMealId);
  }
  for (const d of collections.favourites ?? []) (d.data.type === "meal" ? addMeal : addRecipe)(d.data.targetId);
  for (const d of collections.notes ?? []) addRecipe(d.id);
  for (const d of collections.stats ?? []) {
    const m = /^(recipe|meal)_(.+)$/.exec(d.id);
    if (m) (m[1] === "meal" ? addMeal : addRecipe)(m[2]);
  }
  for (const d of collections.ratings ?? []) (d.data.targetType === "meal" ? addMeal : addRecipe)(d.data.targetId);
  return { recipeIds, mealIds };
}

export type IdMap = ReadonlyMap<string, string>;

const mapId = (m: IdMap, id: unknown) => (typeof id === "string" ? (m.get(id) ?? id) : id);

/**
 * Points every reference at the recipe and meal IDs that exist in this project (an exported recipe may have been
 * purged and matched by fingerprint, §13). Document IDs that embed a target (favourites, notes, stats, ratings) are
 * rebuilt. Returns a new export; the input is not changed.
 */
export function remapExport(e: HouseholdExport, recipes: IdMap, meals: IdMap): HouseholdExport {
  if (recipes.size === 0 && meals.size === 0) return e;
  const forType = (type: unknown) => (type === "meal" ? meals : recipes);
  const c = e.collections;
  const planItems = c.planItems.map((d) => ({
    id: d.id,
    data: {
      ...d.data,
      ...(Array.isArray(d.data.recipes)
        ? { recipes: (d.data.recipes as Array<Record<string, unknown>>).map((r) => ({ ...r, recipeId: mapId(recipes, r.recipeId) })) }
        : {}),
      ...(d.data.savedMealId !== undefined ? { savedMealId: mapId(meals, d.data.savedMealId) } : {}),
    },
  }));
  const cookEvents = c.cookEvents.map((d) => ({
    id: d.id,
    data: {
      ...d.data,
      ...(Array.isArray(d.data.recipeIds) ? { recipeIds: (d.data.recipeIds as unknown[]).map((r) => mapId(recipes, r)) } : {}),
      ...(d.data.savedMealId !== undefined ? { savedMealId: mapId(meals, d.data.savedMealId) } : {}),
    },
  }));
  const favourites = c.favourites.map((d) => {
    const targetId = mapId(forType(d.data.type), d.data.targetId) as string;
    return { id: `${String(d.data.type)}_${targetId}`, data: { ...d.data, targetId } };
  });
  const notes = c.notes.map((d) => ({ id: recipes.get(d.id) ?? d.id, data: d.data }));
  const stats = c.stats.map((d) => {
    const m = /^(recipe|meal)_(.+)$/.exec(d.id);
    if (!m) return d;
    const type = m[1] as "recipe" | "meal";
    return { id: statsId(type, forType(type).get(m[2]!) ?? m[2]!), data: d.data };
  });
  const ratings = c.ratings.map((d) => {
    const targetId = mapId(forType(d.data.targetType), d.data.targetId) as string;
    const id =
      targetId !== d.data.targetId && typeof d.data.cookEventId === "string" && typeof d.data.uid === "string"
        ? ratingId(d.data.cookEventId, d.data.uid, String(d.data.targetType), targetId)
        : d.id;
    return { id, data: { ...d.data, targetId } };
  });
  return {
    ...e,
    collections: { ...c, planItems, cookEvents, favourites, notes, stats, ratings },
    recipes: e.recipes.map((r) => ({ ...r, id: recipes.get(r.id) ?? r.id })),
  };
}

// ---------- supply ledger on import

export interface ReconciledSupply {
  data: SupplyExport["data"];
  transactions: SupplyExport["transactions"];
  /** True when a correction transaction was added so Σ transactions equals the amount. */
  reconciled: boolean;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Keeps the ledger invariant on import (§6): canonicalAmount is Σ lots, and Σ transactions equals it. An export taken
 * from a healthy household already satisfies both; a hand-edited or truncated one gets a correction transaction.
 */
export function reconcileSupply(s: SupplyExport, nowMs: number): ReconciledSupply {
  const lotsSum = round(s.data.lots.reduce((t, l) => t + l.amount, 0));
  const txSum = round(s.transactions.reduce((t, x) => t + x.data.delta, 0));
  const data = { ...s.data, canonicalAmount: lotsSum };
  const diff = round(lotsSum - txSum);
  if (Math.abs(diff) < 1e-6) return { data, transactions: s.transactions, reconciled: false };
  const fix = {
    id: "import-reconcile",
    data: {
      delta: diff,
      kind: "correction",
      lotId: s.data.lots[0]?.lotId ?? "",
      note: "Added on import: the exported history didn't add up to the amount",
      commandId: "import",
      uid: "import",
      createdAt: { __ts: nowMs },
    },
  };
  const id = s.transactions.some((t) => t.id === fix.id) ? `import-reconcile-${nowMs}` : fix.id;
  return { data, transactions: [...s.transactions, { ...fix, id }], reconciled: true };
}

/** Which recipe to use for an exported one: the same ID, else a recipe with the same fingerprint, else create it. */
export function matchRecipe(
  r: Pick<ExportRecipe, "id" | "fingerprint">,
  exists: (id: string) => boolean,
  byFingerprint: (fp: string) => string | undefined,
): { kind: "id"; id: string } | { kind: "fingerprint"; id: string } | { kind: "create" } {
  if (exists(r.id)) return { kind: "id", id: r.id };
  const fp = r.fingerprint ? byFingerprint(r.fingerprint) : undefined;
  if (fp) return { kind: "fingerprint", id: fp };
  return { kind: "create" };
}

// ---------- gathering (the browser's Download, and the functions tests)

type RawDoc = { id: string; data: Record<string, unknown> };

/** How `gatherExport` reads: the web app backs it with the Firestore SDK, tests with the Admin SDK. */
export interface ExportReader {
  household(): Promise<Record<string, unknown> | null>;
  /** All documents of `households/{hid}/{collection}`. */
  list(collection: ExportCollection | "supply"): Promise<RawDoc[]>;
  /** All documents of `households/{hid}/supply/{supplyId}/transactions`. */
  transactions(supplyId: string): Promise<RawDoc[]>;
  recipe(id: string): Promise<Record<string, unknown> | null>;
  meal(id: string): Promise<Record<string, unknown> | null>;
}

export type ExportProgress = (step: string, done: number, total: number) => void;

/** Reads everything an export holds (§13), in order, reporting progress. */
export async function gatherExport(hid: string, reader: ExportReader, nowMs: number, progress: ExportProgress = () => undefined): Promise<ExportInput> {
  const hh = await reader.household();
  if (!hh) throw new ExportError("That household can't be read.");
  const steps = EXPORT_COLLECTIONS.length + 3;
  let step = 0;
  const collections: ExportInput["collections"] = {};
  for (const c of EXPORT_COLLECTIONS) {
    progress(c, step++, steps);
    collections[c] = await reader.list(c);
  }
  progress("supply", step++, steps);
  const supplyDocs = await reader.list("supply");
  const supply: ExportInput["supply"] = [];
  for (const [i, s] of supplyDocs.entries()) {
    progress(`supply history ${i + 1}/${supplyDocs.length}`, step, steps);
    supply.push({ ...s, transactions: await reader.transactions(s.id) });
  }
  step++;
  progress("recipes", step++, steps);
  const { recipeIds, mealIds } = referencedIds(collections);
  const meals: ExportMeal[] = [];
  for (const id of mealIds) {
    const m = await reader.meal(id);
    if (!m) continue;
    const parsed = exportMealSchema.safeParse({ id, name: m.name, recipes: m.recipes });
    if (!parsed.success) continue;
    meals.push(parsed.data);
    for (const r of parsed.data.recipes) recipeIds.add(r.recipeId);
  }
  const recipes: ExportInput["recipes"] = [];
  for (const id of recipeIds) {
    const r = await reader.recipe(id);
    if (!r || typeof r.title !== "string") continue;
    recipes.push({ id, title: r.title, fingerprint: typeof r.fingerprint === "string" ? r.fingerprint : null, cook: recipeToCooklang(r as unknown as RecipeContent) });
  }
  progress("zip", step, steps);
  return { household: { id: hid, data: hh }, collections, supply, recipes, meals, nowMs };
}

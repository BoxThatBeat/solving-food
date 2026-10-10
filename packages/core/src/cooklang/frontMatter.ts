// Front matter contract for dropped `.cook` files (TECHNICAL_SPECS §9 "Claude skill", data/recipes/README.md).
// Required: title, servings, cuisine, main_protein, prep_time, cook_time, tags.
// Optional: source, image, leftover_portions, prep, tools.

import { z } from "zod";
import { CUISINES, MAIN_PROTEINS } from "../taxonomy";

/** "5 minutes", "1 hour", "1 hour 30 minutes", "1h30m", "90 min", "PT1H30M", 45 → minutes. Null when unreadable. */
export function parseDuration(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.round(v);
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t));
  const iso = /^pt(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (iso && (iso[1] || iso[2] || iso[3])) return Number(iso[1] ?? 0) * 60 + Number(iso[2] ?? 0) + Math.round(Number(iso[3] ?? 0) / 60);
  let total = 0;
  let matched = false;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/g)) {
    matched = true;
    const n = Number(m[1]);
    const u = m[2]!;
    total += u.startsWith("h") ? n * 60 : u.startsWith("s") ? n / 60 : n;
  }
  return matched ? Math.round(total) : null;
}

const duration = z.unknown().transform((v, ctx) => {
  const n = parseDuration(v);
  if (n === null) {
    ctx.addIssue({ code: "custom", message: `expected a duration like "15 minutes", got ${JSON.stringify(v)}` });
    return z.NEVER;
  }
  return n;
});

const intLike = (min: number, max: number) =>
  z.union([z.number(), z.string().regex(/^\s*\d+\s*$/)]).transform((v, ctx) => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      ctx.addIssue({ code: "custom", message: `expected a whole number from ${min} to ${max}` });
      return z.NEVER;
    }
    return n;
  });

const stringList = z
  .union([z.array(z.union([z.string(), z.number()])), z.string()])
  .transform((v) =>
    (Array.isArray(v) ? v.map(String) : v.replace(/^\[|\]$/g, "").split(","))
      .map((s) => s.trim())
      .filter(Boolean),
  );

const lowerEnum = <T extends readonly [string, ...string[]]>(values: T, label: string) =>
  z
    .string()
    .transform((s) => s.trim().toLowerCase().replace(/[\s_]+/g, "-"))
    .pipe(z.enum(values, { error: () => `${label} must be one of: ${values.join(", ")}` }));

export const frontMatterSchema = z.object({
  title: z.string().trim().min(1, "title is empty"),
  servings: intLike(1, 100),
  cuisine: lowerEnum(CUISINES, "cuisine"),
  main_protein: lowerEnum(MAIN_PROTEINS, "main_protein"),
  prep_time: duration,
  cook_time: duration,
  tags: stringList,
  source: z.string().trim().optional(),
  image: z.string().trim().optional(),
  leftover_portions: intLike(0, 50).optional(),
  prep: stringList.optional(),
  tools: stringList.optional(),
});
export type FrontMatter = z.infer<typeof frontMatterSchema>;

export const REQUIRED_KEYS = ["title", "servings", "cuisine", "main_protein", "prep_time", "cook_time", "tags"] as const;
export const OPTIONAL_KEYS = ["source", "image", "leftover_portions", "prep", "tools"] as const;

/** Validates front matter; the error message names every bad or missing key, for the import notification. */
export function validateFrontMatter(fm: Record<string, unknown>): { ok: true; value: FrontMatter } | { ok: false; error: string } {
  const r = frontMatterSchema.safeParse(fm);
  if (r.success) return { ok: true, value: r.data };
  const msgs = r.error.issues.map((i) => {
    const key = i.path.join(".") || "front matter";
    const missing = i.path.length > 0 && fm[String(i.path[0])] === undefined;
    return missing ? `missing ${key}` : `${key}: ${i.message}`;
  });
  return { ok: false, error: [...new Set(msgs)].join("; ") };
}

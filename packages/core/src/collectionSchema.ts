// The URL search params of a collection page, apart from collection.ts so the filtering and labels carry no zod (M23:
// the plan worker imports collection helpers only).
import { z } from "zod";
import { CUISINES, MAIN_PROTEINS, RECIPE_COURSES } from "./taxonomy";
import { SORTS } from "./collection";

const csv = <T extends string>(values?: readonly T[]) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      const list = (Array.isArray(v) ? v : (v ?? "").split(",")).map((s) => s.trim()).filter(Boolean);
      const out = values ? list.filter((s): s is T => (values as readonly string[]).includes(s)) : (list as T[]);
      return out.length ? [...new Set(out)] : undefined;
    });

const num = z.coerce.number().int().positive().catch(undefined as never).optional();

/** URL search params of a collection page. Everything optional; unknown values are dropped. */
export const collectionSearchSchema = z.object({
  q: z.string().catch("").optional(),
  sort: z.enum(SORTS).catch(undefined as never).optional(),
  cuisine: csv(CUISINES).catch(undefined).optional(),
  protein: csv(MAIN_PROTEINS).catch(undefined).optional(),
  /** Meal type (course) tags, "side" included (R4.28). */
  meal: csv(RECIPE_COURSES).catch(undefined).optional(),
  tags: csv().catch(undefined).optional(),
  minProtein: num,
  /** Min fibre per serving, g (M9). */
  minFibre: num,
  maxTotal: num,
  maxActive: num,
  minRating: num,
  cooked: z.enum(["before", "never"]).catch(undefined as never).optional(),
  fav: z.coerce.boolean().catch(false).optional(),
  /** Only recipes whose tools the household owns (R11.1). */
  tools: z.coerce.boolean().catch(false).optional(),
  /** Max estimated cost per serving, cents (R4.2). */
  maxCost: num,
  /** Supply filters (R4.2, R4.3, R4.4): "can" = can make with projected supply; "useup" = Use what's left. */
  supply: z.enum(["can", "useup"]).catch(undefined as never).optional(),
  /** Uses supply that expires soon and isn't planned for (R6.13, M5). */
  exp: z.coerce.boolean().catch(false).optional(),
});
export type CollectionSearch = z.infer<typeof collectionSearchSchema>;

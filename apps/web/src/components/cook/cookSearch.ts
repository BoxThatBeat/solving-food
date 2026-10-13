// Search params shared by the cook routes: `step` and `recipe` (opened from a timer notification), `servings`, and
// `mode` (M9): the cook phase's history entry (`mise` for a multi-recipe meal's mise en place, `steps` for step mode),
// so the browser's back button steps back through the phases.
import { z } from "zod";

export const cookSearchSchema = z.object({
  step: z.coerce.number().int().min(0).max(200).catch(undefined as never).optional(),
  recipe: z.string().max(200).catch(undefined as never).optional(),
  servings: z.coerce.number().int().min(1).max(100).catch(undefined as never).optional(),
  mode: z.enum(["mise", "steps"]).catch(undefined as never).optional(),
});
export type CookSearch = z.infer<typeof cookSearchSchema>;

export function initialStepOf(s: CookSearch): { recipeId?: string; step: number } | undefined {
  return s.step === undefined ? undefined : { step: s.step, ...(s.recipe ? { recipeId: s.recipe } : {}) };
}

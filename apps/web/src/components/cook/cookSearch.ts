// Search params shared by the cook routes: `step` and `recipe` (opened from a timer notification), `servings`.
import { z } from "zod";

export const cookSearchSchema = z.object({
  step: z.coerce.number().int().min(0).max(200).catch(undefined as never).optional(),
  recipe: z.string().max(200).catch(undefined as never).optional(),
  servings: z.coerce.number().int().min(1).max(100).catch(undefined as never).optional(),
});
export type CookSearch = z.infer<typeof cookSearchSchema>;

export function initialStepOf(s: CookSearch): { recipeId?: string; step: number } | undefined {
  return s.step === undefined ? undefined : { step: s.step, ...(s.recipe ? { recipeId: s.recipe } : {}) };
}

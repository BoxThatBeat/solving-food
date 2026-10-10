// R12 landing page: Plan if the current period has a plan, otherwise Recipes.

export function landingPath(currentPeriodHasItems: boolean): "/plan" | "/recipes" {
  return currentPeriodHasItems ? "/plan" : "/recipes";
}

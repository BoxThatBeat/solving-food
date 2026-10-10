import { createFileRoute, redirect } from "@tanstack/react-router";
import { landingPath } from "@solving-food/core";

// R12 landing: Plan if the current period has items, else Recipes. Periods arrive in M2, so this is always Recipes.
export const Route = createFileRoute("/_app/")({
  beforeLoad: () => {
    const currentPeriodHasItems = false;
    throw redirect({ to: landingPath(currentPeriodHasItems), replace: true });
  },
});

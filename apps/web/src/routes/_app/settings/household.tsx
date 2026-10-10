import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/settings/household")({
  component: () => <PlaceholderPage {...{ title: "Household", kicker: "Settings", empty: "Period, budget, timezone, servings, and meal types will be editable here.", back: { to: "/settings", label: "Settings" } }} />,
});

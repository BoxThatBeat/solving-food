import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/recipes/$id/edit")({
  component: () => <PlaceholderPage {...{ title: "Edit recipe", kicker: "Recipes", empty: "The recipe editor arrives with the recipe library.", back: { to: "/recipes", label: "Recipes" } }} />,
});

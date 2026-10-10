import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/recipes/trash")({
  component: () => <PlaceholderPage {...{ title: "Trash", kicker: "Recipes \u00b7 kept 30 days", empty: "Trash is empty.", back: { to: "/recipes", label: "Recipes" } }} />,
});

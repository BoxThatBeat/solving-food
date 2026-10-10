import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/recipes/$id/")({
  component: () => <PlaceholderPage {...{ title: "Recipe", kicker: "Recipes", empty: "This recipe doesn't exist yet.", back: { to: "/recipes", label: "Recipes" } }} />,
});

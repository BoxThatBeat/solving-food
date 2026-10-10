import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/recipes/")({
  component: () => <PlaceholderPage {...{ title: "Recipes", kicker: "The shared library", empty: "No recipes yet." }} />,
});

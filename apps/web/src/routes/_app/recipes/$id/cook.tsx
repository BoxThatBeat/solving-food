import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/recipes/$id/cook")({
  component: () => <PlaceholderPage {...{ title: "Cook", kicker: "Recipes", empty: "Step mode arrives with cooking.", back: { to: "/recipes", label: "Recipes" } }} />,
});

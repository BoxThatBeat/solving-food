import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/drop")({
  component: () => <PlaceholderPage {...{ title: "Drop folder", kicker: "Recipe imports", empty: "Drop .cook files here once recipe imports arrive.", back: { to: "/recipes", label: "Recipes" } }} />,
});

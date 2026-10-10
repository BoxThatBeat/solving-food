import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/meals/$id/cook")({
  component: () => <PlaceholderPage {...{ title: "Cook", kicker: "Meals", empty: "Cooking a meal arrives with cooking.", back: { to: "/meals", label: "Meals" } }} />,
});

import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/meals/$id/")({
  component: () => <PlaceholderPage {...{ title: "Meal", kicker: "Meals", empty: "This meal doesn't exist yet.", back: { to: "/meals", label: "Meals" } }} />,
});

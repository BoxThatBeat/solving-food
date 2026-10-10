import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/meals/")({
  component: () => <PlaceholderPage {...{ title: "Meals", kicker: "Saved meals", empty: "No saved meals yet." }} />,
});

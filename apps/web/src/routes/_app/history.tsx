import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/history")({
  component: () => <PlaceholderPage {...{ title: "History", kicker: "Cooked, rated, counted", empty: "Nothing cooked yet in this household." }} />,
});

import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/supply/")({
  component: () => <PlaceholderPage {...{ title: "Supply", kicker: "What's in the kitchen", empty: "Supply is empty." }} />,
});

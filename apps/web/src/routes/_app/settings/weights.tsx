import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/settings/weights")({
  component: () => <PlaceholderPage {...{ title: "Suggestion weights", kicker: "Settings", empty: "Suggestion weights arrive with suggestions.", back: { to: "/settings", label: "Settings" } }} />,
});

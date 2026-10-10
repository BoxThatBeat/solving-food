import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/settings/preferences")({
  component: () => <PlaceholderPage {...{ title: "Preferences", kicker: "Settings", empty: "No food preferences yet.", back: { to: "/settings", label: "Settings" } }} />,
});

import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/settings/stores")({
  component: () => <PlaceholderPage {...{ title: "Stores", kicker: "Settings", empty: "No stores yet.", back: { to: "/settings", label: "Settings" } }} />,
});

import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/settings/data")({
  component: () => <PlaceholderPage {...{ title: "Data", kicker: "Settings", empty: "Download and import arrive with households.", back: { to: "/settings", label: "Settings" } }} />,
});

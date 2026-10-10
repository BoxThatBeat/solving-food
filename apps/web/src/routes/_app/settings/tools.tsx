import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/settings/tools")({
  component: () => <PlaceholderPage {...{ title: "Kitchen tools", kicker: "Settings", empty: "No kitchen tools listed yet.", back: { to: "/settings", label: "Settings" } }} />,
});

import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/settings/brands")({
  component: () => <PlaceholderPage {...{ title: "Brands", kicker: "Settings", empty: "No brand mappings yet.", back: { to: "/settings", label: "Settings" } }} />,
});

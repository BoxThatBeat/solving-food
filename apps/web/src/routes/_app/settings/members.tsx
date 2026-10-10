import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/settings/members")({
  component: () => <PlaceholderPage {...{ title: "Members", kicker: "Settings", empty: "Inviting and removing members arrives with households.", back: { to: "/settings", label: "Settings" } }} />,
});

import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/plan")({
  component: () => <PlaceholderPage {...{ title: "Plan", kicker: "This period", empty: "Nothing planned yet." }} />,
});

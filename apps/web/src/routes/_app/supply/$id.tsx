import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/supply/$id")({
  component: () => <PlaceholderPage {...{ title: "Supply item", kicker: "Supply", empty: "Nothing here yet.", back: { to: "/supply", label: "Supply" } }} />,
});

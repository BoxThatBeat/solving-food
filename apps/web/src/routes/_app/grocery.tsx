import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/Placeholder";

export const Route = createFileRoute("/_app/grocery")({
  component: () => <PlaceholderPage {...{ title: "Grocery", kicker: "The list, by store", empty: "No grocery list yet." }} />,
});

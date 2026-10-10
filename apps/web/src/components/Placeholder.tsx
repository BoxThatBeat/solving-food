import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { EmptyState, PageBody, PageHeader } from "./AppShell";

/** An empty page shell: the route exists and renders its title; its feature lands in a later milestone. */
export function PlaceholderPage({
  title,
  kicker,
  empty,
  back,
}: {
  title: string;
  kicker?: string;
  empty: string;
  back?: { to: string; label: string };
}) {
  return (
    <PageBody>
      {back ? (
        <Link to={back.to} className="inline-flex items-center gap-1 self-start text-sm font-extrabold">
          <ArrowLeft aria-hidden className="size-4" strokeWidth={3} />
          {back.label}
        </Link>
      ) : null}
      <PageHeader title={title} kicker={kicker} />
      <EmptyState>{empty}</EmptyState>
    </PageBody>
  );
}

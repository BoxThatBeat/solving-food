import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PageBody, PageHeader } from "@/components/AppShell";

/** A Settings sub-page: back link, title, content (no kicker above it since the owner review of 2026-11-04). */
export function SettingsPage({ title, kicker, children, wide }: { title: string; kicker?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <PageBody className={wide ? "max-w-[93.75rem]" : "max-w-[60rem]"}>
      <Link to="/settings" className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-extrabold">
        <ArrowLeft aria-hidden className="size-4" strokeWidth={3} />
        Settings
      </Link>
      <PageHeader title={title} kicker={kicker} />
      {children}
    </PageBody>
  );
}

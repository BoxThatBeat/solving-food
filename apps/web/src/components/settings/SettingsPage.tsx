import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PageBody, PageHeader } from "@/components/AppShell";

/** A Settings sub-page: back link, kicker + title, content. */
export function SettingsPage({ title, kicker = "Settings", children, wide }: { title: string; kicker?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <PageBody className={wide ? "max-w-[93.75rem]" : "max-w-[60rem]"}>
      <Link to="/settings" className="inline-flex items-center gap-1 self-start text-sm font-extrabold">
        <ArrowLeft aria-hidden className="size-4" strokeWidth={3} />
        Settings
      </Link>
      <PageHeader title={title} kicker={kicker} />
      {children}
    </PageBody>
  );
}

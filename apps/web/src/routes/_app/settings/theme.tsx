import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Check } from "lucide-react";
import { ACCENTS } from "@solving-food/core";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { ACCENT_HEX, ACCENT_LABELS } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { useNotify } from "@/components/notifications-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings/theme")({
  component: ThemePage,
});

// R11.9: the accent colour, per user. Layout follows the prototype's Theme card. M9 (owner review 2): Catppuccin Latte
// is the only flavour and isn't shown; the flavour picker is gone.
function ThemePage() {
  const [theme, setTheme] = useTheme();
  const notify = useNotify();
  const save = (patch: Partial<typeof theme>) =>
    setTheme(patch).catch(() => notify({ kind: "error", message: "Couldn't save your theme. It applies on this device only." }));
  return (
    <PageBody>
      <Link to="/settings" className="inline-flex items-center gap-1 self-start text-sm font-extrabold">
        <ArrowLeft aria-hidden className="size-4" strokeWidth={3} />
        Settings
      </Link>
      <PageHeader title="Theme" kicker="Settings" />
      <Card className="max-w-[30rem]">
        <div className="flex items-baseline justify-between">
          <h2 className="m-0 font-display text-[1.1875rem] font-normal">Theme</h2>
          <span className="font-mono text-[0.625rem] font-bold">JUST YOU</span>
        </div>
        <fieldset className="m-0 flex flex-col border-0 p-0">
          <legend className="mb-2.5 font-mono text-[0.625rem] font-bold tracking-[0.09rem]">ACCENT</legend>
          <div className="grid grid-cols-6 gap-2">
            {ACCENTS.map((a) => {
              const on = theme.accent === a;
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={on}
                  aria-label={ACCENT_LABELS[a]}
                  title={ACCENT_LABELS[a]}
                  onClick={() => save({ accent: a })}
                  className={cn(
                    "grid aspect-square cursor-pointer place-items-center rounded-ui border-2 border-line p-0 text-[#303446]",
                    !on && "shadow-hard-sm",
                  )}
                  style={{ background: ACCENT_HEX[a] }}
                >
                  {on ? <Check aria-hidden className="size-4" strokeWidth={3.5} /> : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      </Card>
    </PageBody>
  );
}

import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Check } from "lucide-react";
import { ACCENTS, FLAVOURS, FLAVOUR_LABELS } from "@solving-food/core";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { ACCENT_HEX, ACCENT_LABELS, FLAV } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { useNotify } from "@/components/notifications-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings/theme")({
  component: ThemePage,
});

// R11.9: Catppuccin flavour and accent, per user. Layout follows the prototype's Theme card.
function ThemePage() {
  const [theme, setTheme] = useTheme();
  const notify = useNotify();
  const save = (t: typeof theme) =>
    setTheme(t).catch(() => notify({ kind: "error", message: "Couldn't save your theme. It applies on this device only." }));
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
        <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
          <legend className="mb-2.5 font-mono text-[0.625rem] font-bold tracking-[0.09rem]">CATPPUCCIN FLAVOUR</legend>
          <div className="grid grid-cols-4 gap-1.5">
            {FLAVOURS.map((f) => {
              const on = theme.flavour === f;
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={on}
                  onClick={() => save({ ...theme, flavour: f })}
                  className={cn(
                    "flex cursor-pointer flex-col items-stretch gap-[0.3125rem] rounded-ui border-2 border-line p-[0.4375rem] text-xs font-extrabold",
                    on ? "bg-acc text-onc" : "bg-base text-ink shadow-hard-sm",
                  )}
                >
                  <span aria-hidden className="h-[1.125rem] rounded-[3px] border-[1.5px] border-line" style={{ background: FLAV[f].base }} />
                  {FLAVOUR_LABELS[f]}
                </button>
              );
            })}
          </div>
        </fieldset>
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
                  onClick={() => save({ ...theme, accent: a })}
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

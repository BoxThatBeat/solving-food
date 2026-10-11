// Settings → Kitchen tools (PRD R11.1): the equipment the household owns. Recipes that need something missing are
// flagged on their page (R4.14) and can be filtered out with "Have the tools" (<CollectionView>). M7: names show
// lower-case; suggestions are one chip per `toolKey` (core tools.ts: "skillet" also covers "frying pan", "pan"…), and a
// tool you own hides every spelling of it. Stored names stay as typed.
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { groupTools, TOOL_SUGGESTIONS, toolKey, toolLabel } from "@solving-food/core";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/components/notifications-context";
import { useActiveHousehold } from "@/data/households";
import { saveTools } from "@/data/plan";
import { useRecipeIndex } from "@/search/useRecipeSearch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings/tools")({
  component: ToolsPage,
});

function ToolsPage() {
  const hh = useActiveHousehold();
  const notify = useNotify();
  const summaries = useRecipeIndex();
  const tools = hh.data?.settings?.tools ?? [];
  const [text, setText] = React.useState("");
  const have = new Set(tools.map(toolKey));
  const groups = React.useMemo(() => groupTools([...TOOL_SUGGESTIONS, ...(summaries ?? []).flatMap((r) => r.tools ?? [])]), [summaries]);
  const suggestions = groups.filter((g) => !have.has(g.key));
  const write = (next: string[]) => saveTools(hh.id, next).catch((e) => notify({ kind: "error", message: `Couldn't save tools: ${(e as Error).message}` }));
  const add = (t: string) => {
    const v = t.trim();
    if (!v) return;
    const owned = tools.find((x) => toolKey(x) === toolKey(v));
    if (owned) {
      notify({ kind: "info", message: `You already have ${toolLabel(owned)}${toolLabel(owned) !== toolLabel(v) ? `, which covers ${toolLabel(v)}` : ""}.` });
      return;
    }
    void write([...tools, v]);
  };
  return (
    <SettingsPage title="Kitchen tools">
      <Card className="gap-4">
        <CardTitle>Kitchen tools</CardTitle>
        <p className="m-0 text-[0.8125rem] font-semibold">Recipes that need a tool you don't own get flagged.</p>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">YOU OWN · {tools.length}</span>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Tools you own">
            {tools.length === 0 ? <li className="text-[0.8125rem] font-semibold text-sub">None yet. Until you add some, missing tools aren't flagged.</li> : null}
            {tools.map((t) => (
              <li key={t}>
                <button type="button" onClick={() => void write(tools.filter((x) => x !== t))} aria-label={`Remove ${toolLabel(t)}`} className="inline-flex cursor-pointer items-center gap-1.5 rounded-ui border-2 border-line bg-acc px-3 py-2 text-[0.8125rem] font-extrabold text-onc">
                  <Check aria-hidden className="size-3.5" strokeWidth={3.5} />
                  {toolLabel(t)}
                  <X aria-hidden className="size-3.5" strokeWidth={3} />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">SUGGESTIONS</span>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Suggested tools">
            {suggestions.map((g) => (
              <li key={g.key}>
                <button
                  type="button"
                  onClick={() => add(g.label)}
                  aria-label={`Add ${g.label}`}
                  aria-describedby={g.also.length ? `tool-also-${g.key.replace(/\W+/g, "-")}` : undefined}
                  className={cn("flex cursor-pointer flex-col items-start rounded-ui border-2 border-line bg-base px-3 py-2 text-left text-[0.8125rem] font-extrabold text-ink shadow-hard-sm")}
                >
                  <span>+ {g.label}</span>
                  {g.also.length ? (
                    <span id={`tool-also-${g.key.replace(/\W+/g, "-")}`} className="max-w-[16rem] truncate font-mono text-[0.625rem] font-semibold text-sub">
                      also: {g.also.slice(0, 3).join(", ")}
                      {g.also.length > 3 ? ` +${g.also.length - 3}` : ""}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add(text);
            setText("");
          }}
        >
          <Input aria-label="Add a tool" placeholder="Add a tool (e.g. pasta machine)" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} className="flex-1" />
          <Button type="submit" variant="ink" disabled={!text.trim()}>
            Add
          </Button>
        </form>
      </Card>
    </SettingsPage>
  );
}

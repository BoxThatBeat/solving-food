// Settings → Kitchen tools (PRD R11.1): the equipment the household owns. Recipes that need something missing are
// flagged on their page (R4.14) and can be filtered out with "Have the tools" (<CollectionView>).
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { TOOL_SUGGESTIONS } from "@solving-food/core";
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
  const have = new Set(tools.map((t) => t.toLowerCase()));
  const fromRecipes = [...new Set((summaries ?? []).flatMap((r) => r.tools ?? []))];
  const suggestions = [...new Map([...TOOL_SUGGESTIONS, ...fromRecipes].map((t) => [t.toLowerCase(), t])).values()].filter((t) => !have.has(t.toLowerCase())).sort((a, b) => a.localeCompare(b));
  const write = (next: string[]) => saveTools(hh.id, next).catch((e) => notify({ kind: "error", message: `Couldn't save tools: ${(e as Error).message}` }));
  const add = (t: string) => {
    const v = t.trim();
    if (!v || have.has(v.toLowerCase())) return;
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
                <button type="button" onClick={() => void write(tools.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="inline-flex cursor-pointer items-center gap-1.5 rounded-ui border-2 border-line bg-acc px-3 py-2 text-[0.8125rem] font-extrabold text-onc">
                  <Check aria-hidden className="size-3.5" strokeWidth={3.5} />
                  {t}
                  <X aria-hidden className="size-3.5" strokeWidth={3} />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">SUGGESTIONS</span>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Suggested tools">
            {suggestions.map((t) => (
              <li key={t}>
                <button type="button" onClick={() => add(t)} aria-label={`Add ${t}`} className={cn("cursor-pointer rounded-ui border-2 border-line bg-base px-3 py-2 text-[0.8125rem] font-extrabold text-ink shadow-hard-sm")}>
                  + {t}
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

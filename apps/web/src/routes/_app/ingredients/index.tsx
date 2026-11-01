// Ingredients (PRD R4.27, R4.35; Planning/M15; the Gemini key moved to Settings → Gemini in M16): the shared catalogue, to search and open an ingredient to edit.
// Whether a new name from an import is an ingredient you already have is decided by Gemini (on import, or with the
// owner's Check names); the names it wasn't sure about are listed with Copy for Claude and Paste Claude's answer. No
// review cards or merging by hand (M15 removed them).
import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { claudePrompt, isNameWaiting, judgeItems, parseClaudeAnswer, reviewReasons, taxonomyLabel, verdictSummary, type JudgeItem, type Verdict } from "@solving-food/core";
import { EmptyState, PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/chip";
import { useNotify } from "@/components/notifications-context";
import { markNameNew, mergeIngredient, searchIngredients, useAllIngredients, type IngredientEntry } from "@/data/ingredients";
import { checkIngredientNames, useAiStatus, type AiStatus } from "@/data/ai";
import { callError } from "@/data/pcx";
import { useActiveHousehold } from "@/data/households";
import { useReadySession } from "@/session/useSession";

export const Route = createFileRoute("/_app/ingredients/")({
  component: IngredientsPage,
});

function IngredientsPage() {
  const ing = useAllIngredients();
  const hh = useActiveHousehold();
  const ai = useAiStatus(hh.id);
  const [q, setQ] = React.useState("");
  const all = React.useMemo(() => ing.list ?? [], [ing.list]);
  const waiting = React.useMemo(() => all.filter(isNameWaiting).sort((a, b) => a.name.localeCompare(b.name)), [all]);
  const list = React.useMemo(() => (q.trim() ? searchIngredients(all, q, 300) : [...all].sort((a, b) => a.name.localeCompare(b.name))), [all, q]);

  return (
    <PageBody className="max-w-[75rem]">
      <PageHeader title="Ingredients" kicker={`${ing.list ? all.length : "…"} shared ingredients`} />
      <p className="m-0 max-w-[70ch] text-sm leading-normal font-semibold">
        One list for every household; open one to edit it. When an import brings a name the app doesn&apos;t know, Gemini decides whether it&apos;s an ingredient
        that&apos;s already here (and teaches it the new name) or a new one.
      </p>
      {hh.id ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {waiting.length ? <WaitingNames hid={hh.id} waiting={waiting} ing={ing} ai={ai} /> : null}
          {ai && !ai.connected ? (
            <p className="m-0 self-start rounded-ui border-2 border-dashed border-line px-2.5 py-2 text-[0.8125rem] font-bold" data-testid="ai-not-set-up">
              Gemini isn&apos;t set up, so new names wait here.{" "}
              <Link to="/settings/gemini" className="font-extrabold text-ink underline">
                Settings → Gemini
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
      <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ingredients…" aria-label="Search ingredients" className="max-w-[30rem]" />
      {!ing.list ? <p className="m-0 text-sm font-semibold">Loading…</p> : null}
      {ing.list && list.length === 0 ? <EmptyState>No ingredients match.</EmptyState> : null}
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3" aria-label="Ingredients">
        {list.slice(0, 300).map((i) => (
          <li key={i.id}>
            <Link to="/ingredients/$id" params={{ id: i.id }} className="flex items-center justify-between gap-2 rounded-ui border-2 border-line bg-base px-3 py-2.5 text-ink no-underline shadow-hard-sm">
              <span className="text-sm font-extrabold first-letter:uppercase">{i.name}</span>
              <span className="font-mono text-[0.625rem] font-semibold uppercase">
                {taxonomyLabel(i.category)}
                {reviewReasons(i).length ? " · incomplete" : ""}
                {i.freeUse ? " · staple" : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </PageBody>
  );
}

type Ing = ReturnType<typeof useAllIngredients>;

/** The ingredient `id` ends up as, following merges. */
function finalId(id: string, byId: ReadonlyMap<string, IngredientEntry>): string {
  let cur = id;
  for (let n = 0; n < 10 && byId.get(cur)?.mergedInto; n++) cur = byId.get(cur)!.mergedInto!;
  return cur;
}

/** Names Gemini wasn't sure about (R4.27): Check names (owner), or Copy for Claude and paste its answer (R4.35). */
function WaitingNames({ hid, waiting, ing, ai }: { hid: string; waiting: IngredientEntry[]; ing: Ing; ai: AiStatus | null }) {
  const s = useReadySession();
  const notify = useNotify();
  const [busy, setBusy] = React.useState(false);
  const [pasting, setPasting] = React.useState(false);
  const [answer, setAnswer] = React.useState("");
  const items: JudgeItem[] = React.useMemo(
    () =>
      judgeItems(
        waiting.map((w) => ({ name: w.name, exclude: [w.id] })),
        ing.index,
        (id) => ing.byId.get(id),
      ),
    [waiting, ing.index, ing.byId],
  );
  const verdicts = React.useMemo(() => (answer.trim() ? parseClaudeAnswer(answer, items) : null), [answer, items]);
  const plan = verdicts ? verdictSummary(verdicts.values()) : null;

  const check = async () => {
    setBusy(true);
    try {
      const r = await checkIngredientNames(hid);
      if (r.message) notify({ kind: "error", message: `Couldn't check names: ${r.message}` });
      else
        notify({
          kind: "success",
          message: `Gemini checked ${r.checked}: ${r.merged.length} matched${r.merged.length ? ` (${r.merged.map((m) => `${m.from} → ${m.into}`).join(", ")})` : ""}, ${r.kept.length} new, ${r.unsure.length} still unsure${r.remaining ? `; ${r.remaining} more to check` : ""}`,
        });
    } catch (e) {
      notify({ kind: "error", message: `Couldn't check names: ${callError(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(claudePrompt(items));
      notify({ kind: "success", message: "Copied. Paste it into Claude, then paste Claude's answer here." });
      setPasting(true);
    } catch {
      notify({ kind: "error", message: "Couldn't copy to the clipboard" });
    }
  };

  const apply = async (v: Map<string, Verdict>) => {
    setBusy(true);
    let merged = 0;
    let kept = 0;
    const failed: string[] = [];
    for (const w of waiting) {
      const x = v.get(w.name);
      try {
        if (x?.verdict === "same") {
          await mergeIngredient(w.id, finalId(x.id, ing.byId));
          merged++;
        } else if (x?.verdict === "new") {
          await markNameNew(w.id, s.user.uid);
          kept++;
        }
      } catch (e) {
        failed.push(`${w.name} (${callError(e)})`);
      }
    }
    setBusy(false);
    setAnswer("");
    setPasting(false);
    notify({ kind: failed.length ? "error" : "success", message: `${merged} merged, ${kept} kept as new${failed.length ? `; couldn't apply ${failed.join(", ")}` : ""}` });
  };

  return (
    <Card className="gap-3" data-testid="waiting-names">
      <CardTitle>Names to decide</CardTitle>
      <p className="m-0 text-[0.8125rem] font-semibold">
        {waiting.length === 1 ? "Gemini wasn't sure whether this name is" : `Gemini wasn't sure whether these ${waiting.length} names are`} an ingredient you already have
        (or {waiting.length === 1 ? "it" : "they"} came before it was set up). Until then {waiting.length === 1 ? "it's" : "they're"} kept as {waiting.length === 1 ? "a separate ingredient" : "separate ingredients"}.
      </p>
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Names to decide">
        {waiting.map((w) => (
          <li key={w.id}>
            <Link to="/ingredients/$id" params={{ id: w.id }} className="inline-flex rounded-ui border-2 border-line bg-mantle px-2 py-1 text-[0.8125rem] font-extrabold text-ink no-underline">
              {w.name}
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {ai?.canEditKey && ai.connected ? (
          <Button size="sm" disabled={busy} onClick={() => void check()}>
            {busy ? "Checking…" : "Check with Gemini"}
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" disabled={busy || !items.length} onClick={() => void copy()}>
          Copy for Claude
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setPasting((p) => !p)} aria-expanded={pasting}>
          Paste Claude&apos;s answer
        </Button>
      </div>
      {pasting ? (
        <div className="flex flex-col gap-2">
          <Textarea aria-label="Claude's answer" rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Paste Claude's whole reply" className="font-mono text-[0.8125rem]" />
          {plan && verdicts ? (
            <>
              <p role="status" data-testid="claude-plan" className="m-0 font-mono text-[0.6875rem] font-bold uppercase">
                Merge {plan.same} · keep {plan.new} as new · {plan.unsure} still unsure
              </p>
              {plan.same ? (
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[0.8125rem] font-bold">
                  {[...verdicts].flatMap(([name, v]) => (v.verdict === "same" ? [<li key={name}>{`${name} → ${ing.byId.get(v.id)?.name ?? v.id}`}</li>] : []))}
                </ul>
              ) : null}
              <Button size="sm" className="self-start" disabled={busy || plan.same + plan.new === 0} onClick={() => void apply(verdicts)}>
                {busy ? "Applying…" : "Apply"}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

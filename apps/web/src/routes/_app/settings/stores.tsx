// Settings → Stores (PRD R7.4, R11.7; spec §8): stores with kind (PC Express or in store) and a bulk flag, the default
// store, and sourcing rules by category or by ingredient. Resolution: brand mapping → ingredient rule → category rule
// → default store. M5: the PC Express store picker (R6.22), where live prices come from.
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { INGREDIENT_CATEGORIES, taxonomyLabel, type StoreDoc } from "@solving-food/core";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { PcxStorePicker } from "@/components/settings/PcxStorePicker";
import { Card, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/components/notifications-context";
import { IngredientPicker } from "@/components/recipes/IngredientPicker";
import { useActiveHousehold } from "@/data/households";
import { useAllIngredients, type IngredientEntry } from "@/data/ingredients";
import { deleteRule, deleteStore, ruleId, saveRule, saveStore, setDefaultStore, useBrandMappings, useSourcingRules, useStores } from "@/data/plan";
import { useReadySession } from "@/session/useSession";

export const Route = createFileRoute("/_app/settings/stores")({
  component: StoresPage,
});

function StoresPage() {
  const s = useReadySession();
  const hh = useActiveHousehold();
  const notify = useNotify();
  const stores = useStores(hh.id);
  const rules = useSourcingRules(hh.id);
  const mappings = useBrandMappings(hh.id);
  const ing = useAllIngredients();
  const list = (stores.docs ?? []).slice().sort((a, b) => (a.data.kind === b.data.kind ? a.data.name.localeCompare(b.data.name) : a.data.kind === "pcExpress" ? -1 : 1));
  const defaultId = hh.data?.defaultStoreId;
  const err = (what: string) => (e: unknown) => notify({ kind: "error", message: `Couldn't ${what}: ${(e as Error).message}` });
  const [newName, setNewName] = React.useState("");
  const [newKind, setNewKind] = React.useState<StoreDoc["kind"]>("inStore");
  const [newBulk, setNewBulk] = React.useState(false);
  const [picked, setPicked] = React.useState<IngredientEntry | null>(null);
  const [pickedStore, setPickedStore] = React.useState("");
  const catRule = (c: string) => rules.docs?.find((r) => r.id === ruleId({ category: c }));
  const ingRules = (rules.docs ?? []).filter((r) => "ingredientId" in r.data.match);
  const used = (id: string) => (rules.docs ?? []).some((r) => r.data.storeId === id) || (mappings.docs ?? []).some((m) => m.data.storeId === id);

  return (
    <SettingsPage title="Stores" wide>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
        {hh.data ? <PcxStorePicker hid={hh.id} storeId={hh.data.pcxStoreId} storeName={hh.data.pcxStoreName} /> : null}
        <Card className="gap-3">
          <CardTitle>Stores</CardTitle>
          <p className="m-0 text-[0.8125rem] font-semibold">Only PC Express stores are copied to ChatGPT; others become in-store checklists. The default store gets anything no rule or brand sends elsewhere.</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Stores">
            {list.map((st) => (
              <li key={st.id} className="flex flex-col gap-2 rounded-ui border-2 border-line bg-base p-2.5" data-testid="store-row">
                <StoreRow
                  name={st.data.name}
                  kind={st.data.kind}
                  bulk={st.data.bulk}
                  isDefault={st.id === defaultId}
                  canDelete={st.id !== defaultId}
                  onSave={(d) => saveStore(hh.id, st.id, d).then(() => notify({ kind: "success", message: `Saved ${d.name}` }), err("save the store"))}
                  onDefault={() => setDefaultStore(hh.id, st.id).catch(err("set the default store"))}
                  onDelete={() => {
                    if (used(st.id)) notify({ kind: "info", message: `${st.data.name} is used by a rule or brand; items there fall back to the default store.` });
                    void deleteStore(hh.id, st.id).catch(err("delete the store"));
                  }}
                />
              </li>
            ))}
          </ul>
          <form
            className="flex flex-col gap-2 rounded-ui border-2 border-dashed border-line p-2.5"
            aria-label="Add a store"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              void saveStore(hh.id, null, { name: newName.trim(), kind: newKind, bulk: newBulk }).then(() => {
                notify({ kind: "success", message: `Added ${newName.trim()}` });
                setNewName("");
              }, err("add the store"));
            }}
          >
            <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">ADD A STORE</span>
            <div className="flex flex-wrap gap-2">
              <Input aria-label="New store name" placeholder="Farmers' market" value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} className="min-w-[10rem] flex-1" />
              <Select aria-label="New store kind" value={newKind} onChange={(e) => setNewKind(e.target.value as StoreDoc["kind"])} className="w-auto">
                <option value="inStore">In store</option>
                <option value="pcExpress">PC Express</option>
              </Select>
              <label className="flex items-center gap-2 text-sm font-extrabold">
                <input type="checkbox" checked={newBulk} onChange={(e) => setNewBulk(e.target.checked)} className="size-5 accent-[var(--ink)]" />
                Bulk
              </label>
              <Button type="submit" variant="ink" disabled={!newName.trim()}>
                Add
              </Button>
            </div>
          </form>
        </Card>
        </div>

        <Card className="gap-3 p-0 pb-3.5">
          <div className="px-3.5 pt-3.5">
            <CardTitle>Sourcing rules</CardTitle>
          </div>
          <div className="bg-ink px-3.5 py-2 font-mono text-[0.625rem] font-bold tracking-[0.09rem] text-base">STORE BY CATEGORY</div>
          <ul className="m-0 grid list-none grid-cols-1 gap-2 px-3.5 p-0 sm:grid-cols-2" aria-label="Store by category">
            {INGREDIENT_CATEGORIES.map((c) => {
              const r = catRule(c);
              return (
                <li key={c} className="flex items-center justify-between gap-2 rounded-ui border-2 border-line bg-base px-2.5 py-1.5">
                  <label htmlFor={`cat-${c}`} className="text-[0.8125rem] font-extrabold">
                    {taxonomyLabel(c)}
                  </label>
                  <Select
                    id={`cat-${c}`}
                    value={r?.data.storeId ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v) void saveRule(hh.id, { match: { category: c }, storeId: v }).catch(err("save the rule"));
                      else void deleteRule(hh.id, ruleId({ category: c })).catch(err("remove the rule"));
                    }}
                    className="w-auto max-w-[11rem] border-2 px-2 py-1.5 text-[0.75rem] shadow-none"
                  >
                    <option value="">Default store</option>
                    {list.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.data.name}
                      </option>
                    ))}
                  </Select>
                </li>
              );
            })}
          </ul>
          <div className="bg-ink px-3.5 py-2 font-mono text-[0.625rem] font-bold tracking-[0.09rem] text-base">STORE BY INGREDIENT · BEATS CATEGORY</div>
          <ul className="m-0 flex list-none flex-col gap-1.5 px-3.5 p-0" aria-label="Store by ingredient">
            {ingRules.length === 0 ? <li className="text-[0.8125rem] font-semibold text-sub">No ingredient rules.</li> : null}
            {ingRules.map((r) => {
              const iid = "ingredientId" in r.data.match ? r.data.match.ingredientId : "";
              return (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-ui border-2 border-line bg-base px-2.5 py-1.5 text-[0.8125rem] font-extrabold">
                  <span>
                    {ing.byId.get(iid)?.name ?? iid} → {list.find((x) => x.id === r.data.storeId)?.data.name ?? "a deleted store"}
                  </span>
                  <button type="button" aria-label={`Remove rule for ${ing.byId.get(iid)?.name ?? iid}`} onClick={() => void deleteRule(hh.id, r.id).catch(err("remove the rule"))} className="grid size-8 cursor-pointer place-items-center bg-transparent text-ink">
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-2 px-3.5">
            <IngredientPicker ingredients={ing.list ?? []} value={picked ?? undefined} onPick={(i) => setPicked(i)} uid={s.user.uid} label="Ingredient for a rule" />
            <div className="flex gap-2">
              <Select aria-label="Store for this ingredient" value={pickedStore} onChange={(e) => setPickedStore(e.target.value)} className="flex-1">
                <option value="">Pick a store…</option>
                {list.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.data.name}
                  </option>
                ))}
              </Select>
              <Button
                variant="ink"
                disabled={!picked || !pickedStore}
                onClick={() => {
                  if (!picked || !pickedStore) return;
                  void saveRule(hh.id, { match: { ingredientId: picked.id }, storeId: pickedStore }).then(() => setPicked(null), err("save the rule"));
                }}
              >
                Add rule
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </SettingsPage>
  );
}

function StoreRow({ name, kind, bulk, isDefault, canDelete, onSave, onDefault, onDelete }: { name: string; kind: StoreDoc["kind"]; bulk: boolean; isDefault: boolean; canDelete: boolean; onSave: (d: StoreDoc) => void; onDefault: () => void; onDelete: () => void }) {
  const [n, setN] = React.useState(name);
  const [k, setK] = React.useState(kind);
  const [b, setB] = React.useState(bulk);
  const dirty = n.trim() !== name || k !== kind || b !== bulk;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Store name" value={n} maxLength={80} onChange={(e) => setN(e.target.value)} className="min-w-[10rem] flex-1 basis-full border-2 py-2 shadow-none sm:basis-auto" />
        <Select aria-label={`Kind of ${name}`} value={k} onChange={(e) => setK(e.target.value as StoreDoc["kind"])} className="w-auto border-2 py-2 shadow-none">
          <option value="pcExpress">PC Express</option>
          <option value="inStore">In store</option>
        </Select>
        <label className="flex items-center gap-1.5 text-sm font-extrabold">
          <input type="checkbox" checked={b} onChange={(e) => setB(e.target.checked)} className="size-5 accent-[var(--ink)]" aria-label={`${name} is a bulk store`} />
          Bulk
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[0.8125rem] font-extrabold">
          <input type="radio" name="default-store" checked={isDefault} onChange={onDefault} className="size-5 accent-[var(--ink)]" aria-label={`Make ${name} the default store`} />
          Default store
        </label>
        <span className="flex-1" />
        {dirty ? (
          <Button size="sm" onClick={() => onSave({ name: n.trim() || name, kind: k, bulk: b })}>
            Save
          </Button>
        ) : null}
        {canDelete ? (
          <Button size="sm" variant="ghost" onClick={onDelete}>
            Delete
          </Button>
        ) : null}
      </div>
    </>
  );
}

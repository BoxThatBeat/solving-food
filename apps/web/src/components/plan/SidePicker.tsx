// <SidePicker> (PRD R5.9, R5.10; TECHNICAL_SPECS §12): a search dropdown over the household's sides (frozen fries,
// rice, buns…) with the picked ones as removable chips. Picking a side snapshots its current portion per person
// (Settings → Sides) onto the meal; changing the portion later doesn't move meals already made.
import * as React from "react";
import { X } from "lucide-react";
import { formatPortion, MEAL_SIDES_MAX, type MealSide, type SideIngredient } from "@solving-food/core";
import { searchIngredients } from "@/data/ingredients";
import type { SideEntry } from "@/data/sides";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SidePicker({
  value,
  onChange,
  sides,
  servings,
  ingredientOf,
  label = "Add a side",
}: {
  value: readonly MealSide[];
  onChange: (next: MealSide[]) => void;
  /** The household's effective sides; undefined while loading. */
  sides: readonly SideEntry[] | undefined;
  /** When set, chips also show the total for the meal ("× 4 = 600 g"). */
  servings?: number;
  /** Names a picked side the household no longer lists (unflagged since the meal was made). */
  ingredientOf?: (id: string) => SideIngredient | undefined;
  label?: string;
}) {
  const [text, setText] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const listId = React.useId();
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  React.useEffect(() => cancelClose, []);

  const byId = React.useMemo(() => new Map((sides ?? []).map((s) => [s.ingredient.id, s])), [sides]);
  const available = React.useMemo(() => {
    const picked = new Set(value.map((v) => v.ingredientId));
    return (sides ?? []).filter((s) => !picked.has(s.ingredient.id));
  }, [sides, value]);
  const options = React.useMemo(() => {
    if (!text.trim()) return available;
    const hits = searchIngredients(
      available.map((s) => s.ingredient),
      text,
      10,
    );
    return hits.map((i) => byId.get(i.id)!).filter(Boolean);
  }, [available, text, byId]);
  const full = value.length >= MEAL_SIDES_MAX;

  const choose = (k: number) => {
    const o = options[k];
    if (!o || full) return;
    onChange([...value, { ingredientId: o.ingredient.id, portion: o.portion }]);
    setText("");
    setActive(0);
    setOpen(false);
  };
  const remove = (id: string) => onChange(value.filter((v) => v.ingredientId !== id));

  return (
    <div className="flex flex-col gap-2">
      {value.length ? (
        <ul aria-label="Sides" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {value.map((v) => {
            const ing = byId.get(v.ingredientId)?.ingredient ?? ingredientOf?.(v.ingredientId);
            const name = ing?.name ?? "side";
            const each = ing ? formatPortion(v.portion, ing) : "";
            return (
              <li key={v.ingredientId} className="inline-flex items-center gap-1.5 rounded-ui border-2 border-line bg-acc py-1 pr-1 pl-3 text-onc">
                <span className="flex flex-col leading-tight">
                  <span className="text-[0.8125rem] font-extrabold first-letter:uppercase">{name}</span>
                  {each ? (
                    <span className="font-mono text-[0.625rem] font-bold">
                      {each} each{servings && ing ? ` · × ${servings} = ${formatPortion(v.portion * servings, ing)}` : ""}
                    </span>
                  ) : null}
                </span>
                <button type="button" aria-label={`Remove ${name}`} onClick={() => remove(v.ingredientId)} className="grid size-9 flex-none cursor-pointer place-items-center rounded-ui border-2 border-line bg-base text-ink">
                  <X aria-hidden className="size-4" strokeWidth={3} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="relative">
        <label htmlFor={`${listId}-input`} className="sr-only">
          {label}
        </label>
        <Input
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          disabled={full}
          placeholder={full ? `At most ${MEAL_SIDES_MAX} sides` : sides === undefined ? "Loading sides…" : "Search sides (fries, rice, buns…)"}
          value={text}
          onChange={(e) => {
            cancelClose();
            setText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => {
            cancelClose();
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onBlur={() => {
            cancelClose();
            closeTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && open && options.length) {
              e.preventDefault();
              choose(active);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="py-2.5 shadow-hard-sm"
        />
        {open && options.length > 0 ? (
          <ul id={listId} role="listbox" aria-label="Sides to add" className="absolute top-full z-30 m-0 mt-1 max-h-64 w-full list-none overflow-y-auto rounded-ui border-bw bg-base p-0 shadow-hard">
            {options.map((o, k) => (
              <li
                key={o.ingredient.id}
                id={`${listId}-${k}`}
                role="option"
                aria-selected={k === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(k);
                }}
                onMouseEnter={() => setActive(k)}
                className={cn("flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-bold", k && "border-t-2 border-line", k === active ? "bg-acc text-onc" : "text-ink")}
              >
                <span className="first-letter:uppercase">{o.ingredient.name}</span>
                <span className="font-mono text-[0.625rem] font-semibold whitespace-nowrap uppercase">{formatPortion(o.portion, o.ingredient)} / person</span>
              </li>
            ))}
          </ul>
        ) : null}
        {open && text.trim() && options.length === 0 && sides ? (
          <p role="status" className="absolute top-full z-30 m-0 mt-1 w-full rounded-ui border-bw bg-base px-3 py-2 text-sm font-bold text-ink shadow-hard">
            No side matches. Add one in Settings → Sides.
          </p>
        ) : null}
      </div>
    </div>
  );
}

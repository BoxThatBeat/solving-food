// <CoverageStrip> (PRD R6.2; TECHNICAL_SPECS §12): one row per planned meal type, one cell per day labelled with its
// weekday and date. Cells fill left to right from the plan items' coverage: solid = cooked or eaten, outlined =
// planned, overflow as "+n". Not a schedule: the cells aren't interactive (M7: the "not a schedule · cook in any order" hint
// was removed at the owner's request). Not in the prototype; built in its language.
import { stripCount, type DayCell, type StripRow } from "@solving-food/core";
import { cn } from "@/lib/utils";
import { MEAL_LABEL } from "./plan-sheet-context";

const STATE_TEXT = { cooked: "cooked", planned: "planned", open: "open" } as const;

export function CoverageStrip({ rows, cells, todayIndex }: { rows: StripRow[]; cells: DayCell[]; todayIndex: number }) {
  return (
    <section aria-label="Period coverage" className="flex flex-col gap-2.5 rounded-ui border-bw bg-base p-3.5 shadow-hard" data-testid="coverage-strip">
      <span className="font-mono text-[0.6875rem] font-bold tracking-[0.09rem] uppercase">Coverage</span>
      <table className="w-full table-fixed border-separate border-spacing-[0.1875rem]">
        <caption className="sr-only">Meals planned this period by meal type. Solid cells are cooked, outlined cells are planned.</caption>
        <thead>
          <tr>
            <th scope="col" className="w-[4.25rem] p-0 text-left">
              <span className="sr-only">Meal type</span>
            </th>
            {cells.map((c, i) => (
              <th key={c.date} scope="col" title={c.label} className={cn("p-0 text-center font-mono text-[0.5625rem] leading-tight font-bold", i === todayIndex ? "text-ink underline decoration-2 underline-offset-2" : "text-sub")}>
                <span aria-hidden>
                  {c.weekday.slice(0, cells.length > 10 ? 1 : 3)}
                  <br />
                  {c.day}
                </span>
                <span className="sr-only">{c.label}</span>
              </th>
            ))}
            <th scope="col" className="w-[3.75rem] p-0">
              <span className="sr-only">Planned</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mealType} data-testid={`strip-${r.mealType}`}>
              <th scope="row" className="p-0 text-left text-[0.75rem] font-extrabold">
                {MEAL_LABEL[r.mealType]}
              </th>
              {r.cells.map((state, i) => (
                <td key={i} className="p-0" data-state={state}>
                  <span
                    className={cn(
                      "block h-6 rounded-[calc(var(--r)*0.5)]",
                      state === "cooked" && "border-2 border-line bg-acc",
                      state === "planned" && "border-2 border-line bg-base",
                      state === "open" && "border-2 border-dashed border-sub/70 bg-transparent",
                    )}
                  >
                    <span className="sr-only">{STATE_TEXT[state]}</span>
                  </span>
                </td>
              ))}
              <td className="p-0 text-right font-mono text-[0.75rem] font-extrabold whitespace-nowrap" data-testid={`strip-count-${r.mealType}`}>
                {stripCount(r)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

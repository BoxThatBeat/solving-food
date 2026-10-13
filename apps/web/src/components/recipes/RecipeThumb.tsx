// The small framed recipe image next to a recipe name (M10, PRD R4.29): the Plan page's Suggested thumbnail, shared by
// every row that names a recipe (plan cards, Create meal, saved meals, History, Use it up, expiry alerts, the optimiser,
// pending reviews, duplicate review, the cook order list). A recipe without a photo gets the cuisine stripes the
// Suggested card and recipe cards use. Decorative: the row's text names the recipe. `children` overlays it (the
// Suggested score, a "+2" for a meal of several recipes).
import { RecipeImage } from "./RecipeImage";
import { cn } from "@/lib/utils";

export function RecipeThumb({
  base,
  cuisine,
  className,
  children,
}: {
  base: string | null | undefined;
  cuisine: string | null | undefined;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      data-testid="recipe-thumb"
      data-photo={base ? "true" : "false"}
      aria-hidden={children ? undefined : true}
      className={cn("relative block min-h-12 w-16 flex-none self-stretch overflow-hidden rounded-[calc(var(--r)*0.6)] border-2 border-line", className)}
    >
      <RecipeImage base={base} cuisine={cuisine ?? "other"} alt="" sizes="4rem" className="absolute inset-0" />
      {children}
    </span>
  );
}

/** A meal's thumbnail: its first recipe's image, with "+N" when it has more recipes (saved meals, plan meals). */
export function MealThumb({
  ids,
  summary,
  className,
}: {
  ids: readonly string[];
  summary: (id: string) => { thumb?: string | null | undefined; imagePaths?: readonly string[] | undefined; cuisine?: string | undefined } | undefined;
  className?: string;
}) {
  const first = ids[0] ? summary(ids[0]) : undefined;
  const base = first?.thumb ?? first?.imagePaths?.[0] ?? null;
  return (
    <RecipeThumb base={base} cuisine={first?.cuisine} className={className}>
      {ids.length > 1 ? (
        <span aria-hidden className="absolute right-[0.1875rem] bottom-[0.1875rem] rounded-[0.1875rem] bg-ink px-1 py-px font-mono text-[0.625rem] font-extrabold text-base">
          +{ids.length - 1}
        </span>
      ) : null}
    </RecipeThumb>
  );
}

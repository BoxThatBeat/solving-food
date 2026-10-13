// " · 31 g protein · 6 g fibre" for the mono meta lines of cards and rows (R6.15, R6.26). Nothing while the household
// has nutrition tracking off (R6.27, M9).
import { formatFibre, formatProtein } from "@solving-food/core";
import { useNutrition } from "@/data/nutrition";

export function NutritionText({
  r,
  sep = " · ",
}: {
  r: { proteinPerServingG?: number | null | undefined; proteinApproximate?: boolean | undefined; fibrePerServingG?: number | null | undefined; fibreApproximate?: boolean | undefined };
  sep?: string;
}) {
  const n = useNutrition();
  if (!n.on) return null;
  return (
    <>
      {sep}
      {formatProtein(r.proteinPerServingG, r.proteinApproximate)} protein{sep}
      {formatFibre(r.fibrePerServingG, r.fibreApproximate)} fibre
    </>
  );
}

// /supply/:id (PRD R8.5–R8.8; TECHNICAL_SPECS §12): one supply item's purchases, correction, and its full transaction
// history with infinite scroll (25 per page, R8.7).
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { recomputeAmount } from "@solving-food/core";
import { EmptyState, PageBody, PageHeader } from "@/components/AppShell";
import { SupplyDetail } from "@/components/supply/SupplyDetail";
import { amountText, unitFor } from "@/components/supply/format";
import { useActiveHousehold, useMemberNames } from "@/data/households";
import { useSupply } from "@/data/supply";
import { useReadySession } from "@/session/useSession";

export const Route = createFileRoute("/_app/supply/$id")({
  component: SupplyItemPage,
});

function SupplyItemPage() {
  const { id } = Route.useParams();
  const s = useReadySession();
  const hh = useActiveHousehold();
  const tz = hh.data?.timezone ?? "America/Toronto";
  const supply = useSupply(hh.id, tz);
  const members = useMemberNames(hh.id);
  const item = supply.items.get(id);
  const ing = item?.ingredientId ? supply.ingredients.get(item.ingredientId) : undefined;
  const name = item ? item.label.charAt(0).toUpperCase() + item.label.slice(1) : "Supply item";
  return (
    <PageBody className="max-w-[48rem]">
      <Link to="/supply" className="inline-flex items-center gap-1 self-start text-sm font-extrabold text-ink">
        <ArrowLeft aria-hidden className="size-4" strokeWidth={3} />
        Supply
      </Link>
      <PageHeader title={name} kicker={item ? `${amountText(recomputeAmount(item.lots), unitFor(item, ing)).toUpperCase()} IN SUPPLY` : "SUPPLY"} />
      {supply.loading ? null : item ? (
        <div className="rounded-ui border-bw bg-base p-3.5 shadow-hard">
          <SupplyDetail item={item} ingredient={ing} hid={hh.id} uid={s.user.uid} tz={tz} nowMs={supply.now} members={members} />
        </div>
      ) : (
        <EmptyState>This isn't in supply.</EmptyState>
      )}
    </PageBody>
  );
}

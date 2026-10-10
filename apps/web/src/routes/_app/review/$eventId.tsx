// /review/:eventId: the review flow for a cooked meal (PRD R9.2–R9.4), opened by Done cooking or from Pending reviews.
import { createFileRoute } from "@tanstack/react-router";
import { useActiveHousehold } from "@/data/households";
import { ReviewView } from "@/components/cook/ReviewView";
import { useReadySession } from "@/session/useSession";

export const Route = createFileRoute("/_app/review/$eventId")({
  component: ReviewPage,
});

function ReviewPage() {
  const { eventId } = Route.useParams();
  const s = useReadySession();
  const hh = useActiveHousehold();
  return <ReviewView hid={hh.id} uid={s.user.uid} eventId={eventId} tz={hh.data?.timezone ?? "America/Toronto"} />;
}

// <PcxKeyCard> (PRD R6.28; TECHNICAL_SPECS §8 "Authentication"): the owner's PC Express API key. It is the public
// x-apikey the loblaws.ca website sends, not tied to any account; Loblaw can change it, so it is set here (callable
// pcxSetKey) instead of in a deploy. Saving tries it at once. Shown to the project owner only.
import { ApiKeyCard } from "@/components/settings/ApiKeyCard";
import { setPcxKey, usePcxStatus } from "@/data/pcx";

export function PcxKeyCard({ hid }: { hid: string }) {
  const status = usePcxStatus(hid);
  return (
    <ApiKeyCard status={status} title="PC Express API key" service="PC Express" testId="pcx-key" onSave={(k) => setPcxKey(hid, k)}>
      <p className="m-0">
        The public key the loblaws.ca website sends with every request. It isn&apos;t tied to an account. If prices stop updating, Loblaw may have changed it: open loblaws.ca, open the browser&apos;s developer tools on the Network tab, search for any product, click a <span className="font-mono">pcx-bff</span> request, and copy its <span className="font-mono">x-apikey</span> header here.
      </p>
    </ApiKeyCard>
  );
}

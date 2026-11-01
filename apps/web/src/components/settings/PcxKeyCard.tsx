// <PcxKeyCard> (PRD R6.28; TECHNICAL_SPECS §8 "Authentication"): the owner's PC Express API key. It is the public
// x-apikey the loblaws.ca website sends, not tied to any account; Loblaw can change it, so it is set here (callable
// pcxSetKey) instead of in a deploy. Saving tries it at once. Shown to the project owner only.
import * as React from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/components/notifications-context";
import { callError, setPcxKey, usePcxStatus } from "@/data/pcx";

export function PcxKeyCard({ hid }: { hid: string }) {
  const status = usePcxStatus(hid);
  const notify = useNotify();
  const [key, setKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);
  if (!status?.canEditKey) return null;

  const save = async (value: string) => {
    setBusy(true);
    setResult(null);
    try {
      const r = await setPcxKey(hid, value);
      setKey("");
      if (!value) notify({ kind: "success", message: "PC Express key removed: prices come from the estimates" });
      else if (r.connected) notify({ kind: "success", message: "PC Express key saved and working" });
      else setResult(r.message ?? "Saved, but PC Express didn't answer.");
    } catch (e) {
      setResult(`Couldn't save the key: ${callError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3" data-testid="pcx-key">
      <CardTitle>PC Express API key</CardTitle>
      <p className="m-0 text-[0.8125rem] font-semibold">
        The public key the loblaws.ca website sends with every request. It isn't tied to an account. If prices stop updating, Loblaw may have changed it: open loblaws.ca, open the browser's developer tools on the Network tab, search for any product, click a <span className="font-mono">pcx-bff</span> request, and copy its <span className="font-mono">x-apikey</span> header here.
      </p>
      <div className="flex flex-col gap-0.5 rounded-ui border-2 border-line bg-mantle px-2.5 py-2">
        <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">SAVED KEY</span>
        <span className="font-mono text-[0.9375rem] font-bold" data-testid="pcx-key-hint">
          {status.keyHint ?? "None: PC Express is off"}
        </span>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) void save(key.trim());
        }}
      >
        <Input aria-label="PC Express API key" placeholder="Paste x-apikey" value={key} maxLength={200} autoComplete="off" spellCheck={false} onChange={(e) => setKey(e.target.value)} className="min-w-0 flex-1 font-mono" />
        <Button type="submit" variant="ink" disabled={busy || !key.trim()}>
          {busy ? "…" : "Save"}
        </Button>
      </form>
      {result ? (
        <p role="alert" className="m-0 rounded-ui border-2 border-dashed border-line px-2.5 py-2 text-[0.8125rem] font-bold">
          {result}
        </p>
      ) : null}
      {status.keyHint ? (
        <Button variant="ghost" size="sm" className="self-start" disabled={busy} onClick={() => void save("")}>
          Remove key (turns PC Express off)
        </Button>
      ) : null}
    </Card>
  );
}

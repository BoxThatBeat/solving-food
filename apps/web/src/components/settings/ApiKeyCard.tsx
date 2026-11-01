// <ApiKeyCard>: an app-wide key only the owner sets (PRD R6.28 PC Express, R4.36 Gemini). Shows how to get the key,
// the saved key's last characters, paste + Save (tried at once, the result shown), and Remove. Hidden from everyone else.
import * as React from "react";
import { cleanPcxKey, type PcxStatus } from "@solving-food/core";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/components/notifications-context";
import { callError } from "@/data/pcx";

export function ApiKeyCard({
  status,
  title,
  service,
  testId,
  children,
  onSave,
}: {
  status: PcxStatus | null;
  title: string;
  /** "PC Express", "Gemini": used in labels and messages. */
  service: string;
  testId: string;
  /** How to get the key. */
  children: React.ReactNode;
  onSave: (key: string) => Promise<PcxStatus>;
}) {
  const notify = useNotify();
  const [key, setKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);
  if (!status?.canEditKey) return null;

  const save = async (value: string) => {
    setBusy(true);
    setResult(null);
    try {
      const r = await onSave(value);
      setKey("");
      if (!value) notify({ kind: "success", message: `${service} key removed` });
      else if (r.connected) notify({ kind: "success", message: `${service} key saved and working` });
      else setResult(r.message ?? `Saved, but ${service} didn't answer.`);
    } catch (e) {
      setResult(`Couldn't save the key: ${callError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3" data-testid={testId}>
      <CardTitle>{title}</CardTitle>
      <div className="m-0 flex flex-col gap-2 text-[0.8125rem] font-semibold">{children}</div>
      <div className="flex flex-col gap-0.5 rounded-ui border-2 border-line bg-mantle px-2.5 py-2">
        <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">SAVED KEY</span>
        <span className="font-mono text-[0.9375rem] font-bold" data-testid={`${testId}-hint`}>
          {status.keyHint ?? `None: ${service} is off`}
        </span>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (cleanPcxKey(key)) void save(cleanPcxKey(key));
        }}
      >
        <Input aria-label={`${service} API key`} placeholder="Paste the key" value={key} maxLength={300} autoComplete="off" spellCheck={false} onChange={(e) => setKey(e.target.value)} className="min-w-0 flex-1 font-mono" />
        <Button type="submit" variant="ink" disabled={busy || !cleanPcxKey(key)}>
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
          Remove key (turns {service} off)
        </Button>
      ) : null}
    </Card>
  );
}

// Settings → Data (PRD R11.10, TECHNICAL_SPECS §13): download the household's data as a zip, and import such a file
// into the current household after a warning that it replaces the household's data. Members aren't changed.
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Upload } from "lucide-react";
import { ExportError, exportSummary, readExportZip, type ExportSummary } from "@solving-food/core";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useNotify } from "@/components/notifications-context";
import { useActiveHousehold } from "@/data/households";
import { useCommandDoc } from "@/data/supply";
import { downloadHouseholdData, estimateExportReads, startImport } from "@/data/transfer";
import { useReadySession } from "@/session/useSession";

export const Route = createFileRoute("/_app/settings/data")({
  component: DataPage,
});

const nf = new Intl.NumberFormat("en-CA");

function DataPage() {
  const hh = useActiveHousehold();
  return (
    <SettingsPage title="Data">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <DownloadCard key={`d-${hh.id}`} />
        <ImportCard key={`i-${hh.id}`} />
      </div>
    </SettingsPage>
  );
}

function DownloadCard() {
  const hh = useActiveHousehold();
  const notify = useNotify();
  const [estimate, setEstimate] = React.useState<number | null>(null);
  const [progress, setProgress] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    estimateExportReads(hh.id)
      .then((n) => live && setEstimate(n))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [hh.id]);
  const name = hh.data?.name ?? "household";
  const run = async () => {
    setProgress("Starting…");
    try {
      const r = await downloadHouseholdData(hh.id, name, hh.data?.timezone ?? "America/Toronto", (step, done, total) =>
        setProgress(`Reading ${step} · ${Math.round((done / total) * 100)}%`),
      );
      notify({ kind: "success", message: `Saved ${r.fileName} (${nf.format(Math.max(1, Math.round(r.bytes / 1024)))} KB).` });
    } catch (e) {
      notify({ kind: "error", message: `Couldn't download the data: ${e instanceof ExportError ? e.message : (e as Error).message}` });
    } finally {
      setProgress(null);
    }
  };
  return (
    <Card className="gap-3">
      <CardTitle>Download household data</CardTitle>
      <p className="m-0 text-[0.8125rem] leading-normal font-semibold">
        Everything in {name}: supply and its history, plans, grocery lists, cook history, ratings, favourites, notes, and
        settings, plus the recipes and meals it uses (as .cook files). There are no automatic backups, so keep the file
        somewhere safe.
      </p>
      <span className="font-mono text-[0.6875rem] font-semibold text-sub uppercase" data-testid="read-estimate">
        {estimate === null ? "Estimating reads…" : `About ${nf.format(estimate)} Firestore reads`}
      </span>
      <Button className="self-start" onClick={() => void run()} disabled={!!progress}>
        <Download aria-hidden strokeWidth={3} />
        {progress ? "Downloading…" : "Download household data"}
      </Button>
      {progress ? (
        <p role="status" className="m-0 font-mono text-[0.6875rem] font-bold uppercase">
          {progress}
        </p>
      ) : null}
    </Card>
  );
}

function SummaryRow({ label, n }: { label: string; n: number }) {
  return (
    <div className="flex justify-between gap-3 border-b-2 border-dashed border-line py-1 last:border-b-0">
      <dt className="text-[0.8125rem] font-bold">{label}</dt>
      <dd className="m-0 font-mono text-[0.8125rem] font-bold">{nf.format(n)}</dd>
    </div>
  );
}

function ImportCard() {
  const s = useReadySession();
  const hh = useActiveHousehold();
  const notify = useNotify();
  const name = hh.data?.name ?? "this household";
  const [file, setFile] = React.useState<{ name: string; bytes: Uint8Array; summary: ExportSummary } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [cmdId, setCmdId] = React.useState<string | null>(null);
  const cmd = useCommandDoc(hh.id, cmdId);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const status = cmd.data?.status;
  const importing = busy || (!!cmdId && (status === undefined || status === "pending" || status === "running"));

  const pick = async (f: File | undefined) => {
    setError(null);
    setFile(null);
    setCmdId(null);
    if (!f) return;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const parsed = readExportZip(bytes);
      setFile({ name: f.name, bytes, summary: exportSummary(parsed) });
    } catch (e) {
      setError(e instanceof ExportError ? e.message : "That file couldn't be read.");
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const run = async () => {
    if (!file) return;
    setConfirming(false);
    setBusy(true);
    try {
      setCmdId(await startImport(hh.id, s.user.uid, file.bytes));
      setBusy(false);
    } catch (e) {
      setBusy(false);
      notify({ kind: "error", message: `Couldn't upload the file: ${(e as Error).message}` });
    }
  };

  const sm = file?.summary;
  return (
    <Card className="gap-3">
      <CardTitle>Import household data</CardTitle>
      <p className="m-0 text-[0.8125rem] leading-normal font-semibold">
        Load a downloaded file into {name}. It <strong>replaces</strong> this household&apos;s supply, plans, history, ratings,
        and settings. Members stay as they are.
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[0.6875rem] font-bold tracking-[0.06rem] uppercase">Export file (.zip)</span>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          disabled={importing}
          onChange={(e) => void pick(e.target.files?.[0])}
          className="rounded-ui border-2 border-line bg-pg p-2 text-[0.8125rem] font-semibold file:mr-3 file:cursor-pointer file:rounded-ui file:border-2 file:border-line file:bg-base file:px-2.5 file:py-1.5 file:font-extrabold file:text-ink"
        />
      </label>
      {error ? (
        <p role="alert" className="m-0 rounded-ui border-2 border-line bg-red-soft p-2.5 text-[0.8125rem] font-bold">
          {error}
        </p>
      ) : null}
      {sm ? (
        <section aria-label="File summary" className="flex flex-col gap-2 rounded-ui border-2 border-line bg-pg p-3">
          <span className="font-mono text-[0.6875rem] font-bold uppercase">
            {sm.householdName} · exported {new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(sm.exportedAt)} · format v
            {sm.version}
          </span>
          <dl className="m-0 flex flex-col">
            <SummaryRow label="Plan items" n={sm.counts.planItems} />
            <SummaryRow label="Supply items" n={sm.counts.supply} />
            <SummaryRow label="Supply history entries" n={sm.counts.transactions} />
            <SummaryRow label="Cooked meals" n={sm.counts.cookEvents} />
            <SummaryRow label="Ratings" n={sm.counts.ratings} />
            <SummaryRow label="Grocery lists" n={sm.counts.groceryLists} />
            <SummaryRow label="Favourites" n={sm.counts.favourites} />
            <SummaryRow label="Recipes and meals used" n={sm.counts.recipes + sm.counts.meals} />
          </dl>
          <span className="font-mono text-[0.625rem] font-semibold text-sub uppercase">About {nf.format(sm.documents)} documents to write</span>
        </section>
      ) : null}
      {file ? (
        <Button className="self-start" onClick={() => setConfirming(true)} disabled={importing}>
          <Upload aria-hidden strokeWidth={3} />
          {importing ? "Importing…" : `Import into ${name}`}
        </Button>
      ) : null}
      {cmdId ? (
        <p role="status" className="m-0 font-mono text-[0.6875rem] font-bold uppercase">
          {status === "applied"
            ? `Imported. ${cmd.data?.result ?? ""}`
            : status === "failed"
              ? `Import failed: ${cmd.data?.error ?? ""}`
              : status === "running"
                ? "Replacing the household's data…"
                : "Uploading and queueing the import…"}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Replace ${name}'s data?`}
        confirmLabel="Replace data"
        destructive
        onConfirm={() => void run()}
      >
        <p className="m-0">
          Everything in {name} (supply and its history, plans, grocery lists, cook history, ratings, favourites, notes, and
          settings) is replaced by the data from {sm?.householdName ?? "the file"}. Members stay as they are. This can&apos;t be
          undone, so download this household&apos;s data first if you might want it back.
        </p>
      </ConfirmDialog>
    </Card>
  );
}

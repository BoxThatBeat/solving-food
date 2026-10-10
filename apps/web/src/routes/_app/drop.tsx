// /drop (TECHNICAL_SPECS §9 "Getting files in", PRD R4.16): drag and drop or pick several .cook files (and the photos
// they reference by file name). Photos upload first, then the recipes, to recipe-drop/{uid}/. The import function
// reports each result as a notification on whatever page is open.
import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ref, uploadBytes } from "firebase/storage";
import { ArrowLeft, Upload } from "lucide-react";
import { splitFrontMatter } from "@solving-food/core";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/chip";
import { useNotify } from "@/components/notifications-context";
import { storage } from "@/firebase/app";
import { useReadySession } from "@/session/useSession";
import { useOnline } from "@/hooks/useOnline";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/drop")({
  component: DropPage,
});

const MAX_COOK = 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;

type Status = "uploading" | "uploaded" | "error" | "skipped";
interface Row {
  key: string;
  name: string;
  kind: "recipe" | "photo";
  status: Status;
  note?: string;
}

const BUCKET = "solvingfood.firebasestorage.app";

function isCook(f: File) {
  return /\.cook$/i.test(f.name);
}

/** The image file name a .cook's front matter refers to, when it's a relative path. */
async function referencedImage(f: File): Promise<string | null> {
  try {
    const { frontMatter } = splitFrontMatter(await f.text());
    const img = typeof frontMatter.image === "string" ? frontMatter.image.trim() : "";
    if (!img || /^https?:\/\//i.test(img)) return null;
    return img.split(/[\\/]/).pop() ?? null;
  } catch {
    return null;
  }
}

function DropPage() {
  const s = useReadySession();
  const notify = useNotify();
  const online = useOnline();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [over, setOver] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const upload = async (files: File[]) => {
    if (!files.length) return;
    const cooks = files.filter(isCook);
    const photos = files.filter((f) => !isCook(f) && f.type.startsWith("image/"));
    const others = files.filter((f) => !isCook(f) && !f.type.startsWith("image/"));
    const stamp = Date.now();
    const newRows: Row[] = [
      ...photos.map((f, i) => ({ key: `${stamp}-p${i}`, name: f.name, kind: "photo" as const, status: "uploading" as Status })),
      ...cooks.map((f, i) => ({ key: `${stamp}-c${i}`, name: f.name, kind: "recipe" as const, status: "uploading" as Status })),
      ...others.map((f, i) => ({ key: `${stamp}-o${i}`, name: f.name, kind: "recipe" as const, status: "skipped" as Status, note: "Only .cook files and photos" })),
    ];
    setRows((rs) => [...newRows, ...rs]);

    // Warn about photos a recipe refers to but that weren't dropped with it.
    for (const f of cooks) {
      const img = await referencedImage(f);
      if (img && !photos.some((p) => p.name === img)) {
        notify({ kind: "info", message: `${f.name} refers to the photo “${img}”. Drop it together with the recipe, or it imports without a photo.` });
      }
    }

    const put = async (f: File, row: Row, contentType: string, max: number) => {
      if (f.size > max) {
        update(row.key, { status: "error", note: `Too large (max ${Math.round(max / 1024 / 1024)} MB)` });
        return;
      }
      try {
        await uploadBytes(ref(storage, `recipe-drop/${s.user.uid}/${f.name}`), f, { contentType });
        update(row.key, { status: "uploaded", note: row.kind === "recipe" ? "Importing… the result appears as a notification" : "Waiting for its recipe" });
      } catch (e) {
        update(row.key, { status: "error", note: (e as Error).message.replace(/^Firebase Storage: /, "") });
      }
    };
    // Photos first, so the import finds them.
    await Promise.all(photos.map((f, i) => put(f, newRows[i]!, f.type || "image/jpeg", MAX_IMAGE)));
    await Promise.all(cooks.map((f, i) => put(f, newRows[photos.length + i]!, "text/plain", MAX_COOK)));
  };

  const pickFiles = (list: FileList | null) => void upload(list ? [...list] : []);

  return (
    <PageBody className="max-w-[60rem]">
      <Link to="/recipes" className="inline-flex items-center gap-1 self-start text-sm font-extrabold">
        <ArrowLeft aria-hidden className="size-4" strokeWidth={3} />
        Recipes
      </Link>
      <PageHeader title="Drop recipes" kicker="Drop folder · Cooklang" />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pickFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-ui border-bw border-dashed p-6 text-center md:p-10",
          over ? "bg-acc text-onc" : "bg-base text-ink",
        )}
        data-testid="drop-zone"
      >
        <Upload aria-hidden className="size-8" strokeWidth={2.5} />
        <p className="m-0 max-w-[40ch] text-[0.9375rem] font-extrabold">Drag .cook files here, with the photos they mention</p>
        <button
          type="button"
          disabled={!online}
          onClick={() => input.current?.click()}
          className="press cursor-pointer rounded-ui border-bw bg-acc px-4 py-3 text-[0.9375rem] font-extrabold text-onc shadow-hard disabled:cursor-not-allowed disabled:opacity-55"
        >
          Choose files
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept=".cook,image/*"
          className="sr-only"
          aria-label="Choose .cook files and photos"
          onChange={(e) => {
            pickFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {!online ? <p className="m-0 text-sm font-bold">You&apos;re offline. Uploading needs a connection.</p> : null}
      </div>

      {rows.length ? (
        <Card>
          <SectionLabel hint={`${rows.length} files`}>This session</SectionLabel>
          <ul className="m-0 flex list-none flex-col p-0" aria-label="Uploaded files">
            {rows.map((r, k) => (
              <li key={r.key} className={cn("flex items-center gap-2.5 py-2", k && "border-t-2 border-line")}>
                <span className="min-w-0 flex-1 truncate font-mono text-xs font-bold">{r.name}</span>
                <span className="text-xs font-semibold text-sub">{r.note}</span>
                <span
                  className={cn(
                    "flex-none rounded-[calc(var(--r)*0.5)] border-2 border-line px-1.5 py-0.5 font-mono text-[0.625rem] font-bold uppercase",
                    r.status === "uploaded" ? "bg-acc text-onc" : r.status === "error" ? "bg-red text-onc" : "bg-base text-ink",
                  )}
                >
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <SectionLabel>How recipes get here</SectionLabel>
        <ol className="m-0 flex flex-col gap-2 pl-5 text-sm leading-normal font-semibold">
          <li>
            Give Claude a recipe link or a photo and ask it to use the <strong>cooklang-recipe</strong> skill (in this repo at{" "}
            <code className="font-mono text-xs">.claude/skills/cooklang-recipe</code>). It writes a <code className="font-mono text-xs">.cook</code> file with the
            cuisine, main protein, and tags the app expects.
          </li>
          <li>Drop the file here (with its photo, if the photo is a file rather than a link). The file is deleted once it&apos;s imported.</li>
          <li>
            Or upload from a terminal (the project owner, signed in to gcloud):
            <pre className="mt-1.5 overflow-x-auto rounded-ui border-2 border-line bg-pg p-2.5 font-mono text-[0.6875rem] leading-relaxed whitespace-pre">
              gcloud storage cp photo.jpg recipe.cook gs://{BUCKET}/recipe-drop/{s.user.uid}/
            </pre>
          </li>
        </ol>
        <p className="m-0 text-xs font-semibold text-sub">
          Each import shows a notification: success with a link to the recipe, a duplicate waiting for review on the Recipes page, or the reason it failed.
        </p>
      </Card>
    </PageBody>
  );
}

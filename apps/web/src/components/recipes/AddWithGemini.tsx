// <AddWithGemini> (PRD R4.37; Planning/M16): the Add recipe sheet's three Gemini options: paste a web recipe link,
// upload photos of a recipe, take photos of a recipe. Chosen (or pasted) photos wait in the sheet, where more can be
// added (a recipe over several pages, and the finished dish: Gemini works out which is which), with an optional box for
// the recipe's text, then go to Gemini together. The function writes a .cook file following the Claude skill and imports
// it like a dropped file; this shows the wait (several seconds), then opens the new recipe. Says plainly when Gemini
// isn't set up (Settings → Gemini).
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { Camera, ImageUp, Link2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/chip";
import { addRecipeFromLink, addRecipeFromPhotos, MAX_RECIPE_PHOTOS, useAiStatus, type AddRecipeResult } from "@/data/ai";
import { callError } from "@/data/pcx";
import { useActiveHousehold } from "@/data/households";
import { useReadySession } from "@/session/useSession";

const optionClass = "flex cursor-pointer items-center gap-3 rounded-ui border-bw bg-base p-3.5 text-ink shadow-hard has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2";
const MAX_TEXT = 30_000;

const smallOptionClass = cn(buttonVariants({ variant: "secondary", size: "sm" }), "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-55");

/** The images in a paste (copied pictures). */
function pastedImages(e: React.ClipboardEvent): File[] {
  return Array.from(e.clipboardData?.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((f): f is File => !!f);
}

/** A chosen photo's thumbnail with its remove button. */
function PhotoTile({ file, n, disabled, onRemove }: { file: File; n: number; disabled: boolean; onRemove: () => void }) {
  // The object URL is made and revoked in one effect and set on the <img> directly, so StrictMode's second run gets a
  // fresh URL instead of a revoked one.
  const img = React.useRef<HTMLImageElement>(null);
  React.useEffect(() => {
    const u = URL.createObjectURL(file);
    if (img.current) img.current.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <li className="relative">
      <img ref={img} alt={`Photo ${n}`} title={file.name || undefined} className="size-24 rounded-ui border-2 border-line bg-mantle object-cover" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
      {/* A 44 px hit area around a smaller box, so the button doesn't hide the photo. */}
      <button type="button" aria-label={`Remove photo ${n}`} disabled={disabled} onClick={onRemove} className="group absolute -top-3.5 -right-3.5 grid size-11 cursor-pointer place-items-center rounded-ui disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-3 focus-visible:outline-offset-0">
        <span className="grid size-7 place-items-center rounded-ui border-2 border-line bg-base text-ink shadow-hard-sm group-active:translate-x-px group-active:translate-y-px group-active:shadow-none">
          <X aria-hidden className="size-4" strokeWidth={2.5} />
        </span>
      </button>
    </li>
  );
}

export function AddWithGemini({ onAdded }: { onAdded: (r: AddRecipeResult) => void }) {
  const s = useReadySession();
  const hh = useActiveHousehold();
  const ai = useAiStatus(hh.id);
  const [url, setUrl] = React.useState("");
  const [photos, setPhotos] = React.useState<File[]>([]);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState<null | "link" | "photo">(null);
  const [error, setError] = React.useState<string | null>(null);
  const textRef = React.useRef<HTMLTextAreaElement>(null);

  const hasPhotos = photos.length > 0;
  React.useEffect(() => {
    if (hasPhotos) textRef.current?.focus();
  }, [hasPhotos]);

  const run = async (kind: "link" | "photo", fn: () => Promise<AddRecipeResult>) => {
    setBusy(kind);
    setError(null);
    try {
      onAdded(await fn());
    } catch (e) {
      setError(callError(e));
    } finally {
      setBusy(null);
    }
  };
  const choose = (files: File[]) => {
    if (!files.length) return;
    const room = MAX_RECIPE_PHOTOS - photos.length;
    setError(files.length > room ? `Up to ${MAX_RECIPE_PHOTOS} photos for one recipe` : null);
    setPhotos((prev) => [...prev, ...files].slice(0, MAX_RECIPE_PHOTOS));
  };
  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    choose(files);
  };
  const full = photos.length >= MAX_RECIPE_PHOTOS;
  const off = ai !== null && !ai.connected;
  const onPaste = (e: React.ClipboardEvent) => {
    if (busy || off) return;
    const files = pastedImages(e);
    if (files.length) {
      e.preventDefault();
      choose(files);
    }
  };

  return (
    <section aria-label="Add with Gemini" className="flex flex-col gap-2.5" data-testid="add-with-gemini" onPaste={onPaste}>
      <span className="tabular-nums text-[0.625rem] font-bold tracking-[0.045rem]">Let Gemini add it</span>
      {off ? (
        <p className="m-0 rounded-ui border-2 border-dashed border-line px-2.5 py-2 text-[0.8125rem] font-bold">
          Gemini isn&apos;t set up yet{ai?.canEditKey ? "" : " (the app's owner adds its key)"}.{" "}
          <Link to="/settings/gemini" className="font-extrabold text-ink underline">
            Settings → Gemini
          </Link>
        </p>
      ) : null}
      <form
        className="flex flex-col gap-2 rounded-ui border-bw bg-base p-3.5 shadow-hard"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) void run("link", () => addRecipeFromLink(url.trim()));
        }}
      >
        <label htmlFor="gemini-url" className="flex items-center gap-2 text-lg font-extrabold">
          <Link2 aria-hidden className="size-5" strokeWidth={2.5} />
          Paste a web recipe link
        </label>
        <div className="flex gap-2">
          <Input id="gemini-url" type="url" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} disabled={!!busy || off} className="min-w-0 flex-1" />
          <Button type="submit" variant="ink" disabled={!!busy || off || !url.trim()}>
            {busy === "link" ? "…" : "Add"}
          </Button>
        </div>
      </form>
      {hasPhotos ? (
        <form
          className="flex flex-col gap-3 rounded-ui border-bw bg-base p-3.5 shadow-hard"
          data-testid="gemini-photo"
          onSubmit={(e) => {
            e.preventDefault();
            void run("photo", () => addRecipeFromPhotos(s.user.uid, photos, text));
          }}
        >
          <ul aria-label="Chosen photos" className="m-0 flex list-none flex-wrap gap-3 p-0 pt-2 pr-2">
            {photos.map((f, i) => (
              <PhotoTile key={`${i}-${f.name}-${f.size}-${f.lastModified}`} file={f} n={i + 1} disabled={!!busy} onRemove={() => setPhotos((prev) => prev.filter((_, j) => j !== i))} />
            ))}
          </ul>
          {full ? null : (
            <div className="flex flex-wrap gap-2">
              <label className={smallOptionClass} aria-disabled={!!busy}>
                <ImageUp aria-hidden strokeWidth={2.5} />
                Add a photo
                <input type="file" accept="image/*" multiple className="sr-only" onChange={onPhoto} disabled={!!busy} aria-label="Add another photo" />
              </label>
              <label className={smallOptionClass} aria-disabled={!!busy}>
                <Camera aria-hidden strokeWidth={2.5} />
                Take a photo
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} disabled={!!busy} aria-label="Take another photo" />
              </label>
            </div>
          )}
          <Textarea ref={textRef} aria-label="Recipe text" placeholder="Recipe text (optional)" rows={5} maxLength={MAX_TEXT} value={text} onChange={(e) => setText(e.target.value)} disabled={!!busy} />
          <Button type="submit" variant="ink" className="self-end" disabled={!!busy}>
            {busy === "photo" ? "…" : "Add"}
          </Button>
        </form>
      ) : (
        <>
          <label className={optionClass} aria-disabled={!!busy || off}>
            <ImageUp aria-hidden className="size-5 flex-none" strokeWidth={2.5} />
            <span className="flex flex-col gap-1">
              <span className="text-lg font-extrabold">Upload photos of a recipe</span>
              <span className="text-xs font-semibold text-sub">Every page of it, and the finished dish if you have one.</span>
            </span>
            <input type="file" accept="image/*" multiple className="sr-only" onChange={onPhoto} disabled={!!busy || off} aria-label="Upload photos of a recipe" />
          </label>
          <label className={optionClass} aria-disabled={!!busy || off}>
            <Camera aria-hidden className="size-5 flex-none" strokeWidth={2.5} />
            <span className="flex flex-col gap-1">
              <span className="text-lg font-extrabold">Take photos of a recipe</span>
              <span className="text-xs font-semibold text-sub">Opens the camera on a phone; add more pages after.</span>
            </span>
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} disabled={!!busy || off} aria-label="Take photos of a recipe" />
          </label>
        </>
      )}
      {busy ? (
        <p role="status" className="m-0 tabular-nums text-[0.6875rem] font-bold" data-testid="gemini-busy">
          Gemini is reading the {busy === "link" ? "page" : photos.length > 1 ? "photos" : "photo"} and writing the recipe… this takes 10–60 seconds
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 rounded-ui border-2 border-dashed border-line px-2.5 py-2 text-[0.8125rem] font-bold">
          {error}
        </p>
      ) : null}
    </section>
  );
}

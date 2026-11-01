// <AddWithGemini> (PRD R4.37; Planning/M16): the Add recipe sheet's three Gemini options: paste a web recipe link,
// upload a photo of a recipe, take a photo of a recipe. The function writes a .cook file following the Claude skill and
// imports it like a dropped file; this shows the wait (several seconds), then opens the new recipe. Says plainly when
// Gemini isn't set up (Settings → Gemini).
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { Camera, ImageUp, Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { addRecipeFromLink, addRecipeFromPhoto, useAiStatus, type AddRecipeResult } from "@/data/ai";
import { callError } from "@/data/pcx";
import { useActiveHousehold } from "@/data/households";
import { useReadySession } from "@/session/useSession";

const optionClass = "flex cursor-pointer items-center gap-3 rounded-ui border-bw bg-base p-3.5 text-ink shadow-hard has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2";

export function AddWithGemini({ onAdded }: { onAdded: (r: AddRecipeResult) => void }) {
  const s = useReadySession();
  const hh = useActiveHousehold();
  const ai = useAiStatus(hh.id);
  const [url, setUrl] = React.useState("");
  const [busy, setBusy] = React.useState<null | "link" | "photo">(null);
  const [error, setError] = React.useState<string | null>(null);

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
  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) void run("photo", () => addRecipeFromPhoto(s.user.uid, f));
  };

  const off = ai !== null && !ai.connected;
  return (
    <section aria-label="Add with Gemini" className="flex flex-col gap-2.5" data-testid="add-with-gemini">
      <span className="font-mono text-[0.625rem] font-bold tracking-[0.09rem]">LET GEMINI ADD IT</span>
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
      <label className={optionClass} aria-disabled={!!busy || off}>
        <ImageUp aria-hidden className="size-5 flex-none" strokeWidth={2.5} />
        <span className="flex flex-col gap-1">
          <span className="text-lg font-extrabold">Upload a photo of a recipe</span>
          <span className="text-xs font-semibold text-sub">A cookbook page or a recipe card from your photos.</span>
        </span>
        <input type="file" accept="image/*" className="sr-only" onChange={onPhoto} disabled={!!busy || off} aria-label="Upload a photo of a recipe" />
      </label>
      <label className={optionClass} aria-disabled={!!busy || off}>
        <Camera aria-hidden className="size-5 flex-none" strokeWidth={2.5} />
        <span className="flex flex-col gap-1">
          <span className="text-lg font-extrabold">Take a photo of a recipe</span>
          <span className="text-xs font-semibold text-sub">Opens the camera on a phone.</span>
        </span>
        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} disabled={!!busy || off} aria-label="Take a photo of a recipe" />
      </label>
      {busy ? (
        <p role="status" className="m-0 font-mono text-[0.6875rem] font-bold uppercase" data-testid="gemini-busy">
          Gemini is reading the {busy === "link" ? "page" : "photo"} and writing the recipe… this takes 10–60 seconds
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

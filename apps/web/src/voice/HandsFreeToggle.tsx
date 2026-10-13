// <HandsFreeToggle> (PRD R4.31): the small switch in the header of every cooking page from mise en place on (mise en
// place, step mode, the review). Mounting it is what lets the engine run; pressing it off silences speech and closes
// the microphone at once. Its state shows in the icon only (off, loading, listening, speaking, muted); the app shows no
// text about what can be said (the owner asked for none).
import * as React from "react";
import { Loader2, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useNotify } from "@/components/notifications-context";
import { cn } from "@/lib/utils";
import { handsFree, useHandsFree } from "./handsFree";

let shownError = 0;

export function HandsFreeToggle({ className }: { className?: string }) {
  const s = useHandsFree();
  const notify = useNotify();
  React.useEffect(() => handsFree.host(), []);
  React.useEffect(() => {
    if (s.error && s.error.id !== shownError) {
      shownError = s.error.id;
      notify({ kind: "error", message: s.error.message });
    }
  }, [s.error, notify]);

  const on = s.enabled;
  const state = !on ? "off" : s.status === "loading" ? "loading" : s.muted ? "muted" : s.speaking ? "speaking" : "listening";
  const Icon = state === "off" ? MicOff : state === "loading" ? Loader2 : state === "muted" ? VolumeX : state === "speaking" ? Volume2 : Mic;
  const words = { off: "", loading: "Starting", listening: "Listening", speaking: "Speaking", muted: "Muted" }[state];
  const id = React.useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Hands-free"
      aria-describedby={words ? id : undefined}
      title="Hands-free"
      onClick={() => handsFree.setEnabled(!on)}
      data-testid="hands-free"
      data-state={state}
      className={cn(
        "flex h-11 flex-none cursor-pointer items-center gap-1.5 rounded-ui border-2 border-line px-2 shadow-hard-sm",
        on ? "bg-acc text-onc" : "bg-base text-ink",
        className,
      )}
    >
      <Icon aria-hidden className={cn("size-5", state === "loading" && "motion-safe:animate-spin")} strokeWidth={2.5} />
      <span className="hidden font-mono text-[0.625rem] font-bold tracking-[0.06rem] uppercase md:inline">Hands-free</span>
      <span aria-hidden className={cn("relative h-5 w-8 flex-none rounded-full border-2 border-line", on ? "bg-ink" : "bg-mantle")}>
        <span className={cn("absolute top-0.5 size-3 rounded-full border-2 border-line", on ? "right-0.5 bg-acc" : "left-0.5 bg-base")} />
      </span>
      {words ? (
        <span id={id} className="sr-only">
          {words}
        </span>
      ) : null}
    </button>
  );
}

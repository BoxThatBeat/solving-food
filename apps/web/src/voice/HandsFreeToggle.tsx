// <HandsFreeToggle> (PRD R4.31): the small switch in the header of every cooking page from mise en place on (mise en
// place, step mode, the review). Mounting it is what lets the engine run; pressing it off silences speech and closes
// the microphone at once. Its state shows in the icon only (off, loading, listening, speaking, muted, error); the app
// shows no text about what can be said (the owner asked for none). The tap is the only way hands-free starts (M12), and
// `setEnabled` must run synchronously in it (it speaks Safari's unlock utterance). M13: a "heard" look (a pulsing sound
// wave) from the moment speech goes to the recogniser until its command has been applied, so the user doesn't repeat
// it; and, only after `?voicedebug=1`, the owner's diagnostics button next to it (a lazy chunk).
import * as React from "react";
import { AudioLines, Loader2, Mic, MicOff, TriangleAlert, Volume2, VolumeX } from "lucide-react";
import { useNotify } from "@/components/notifications-context";
import { cn } from "@/lib/utils";
import { refreshDiagFlag } from "./diag";
import { handsFree, useHandsFree } from "./handsFree";

const VoiceDiagnostics = React.lazy(() => import("./VoiceDiagnostics"));

let shownError = 0;

export function HandsFreeToggle({ className }: { className?: string }) {
  const s = useHandsFree();
  const notify = useNotify();
  const [debug] = React.useState(refreshDiagFlag);
  React.useEffect(() => handsFree.host(), []);
  React.useEffect(() => {
    if (s.error && s.error.id !== shownError) {
      shownError = s.error.id;
      notify({ kind: "error", message: s.error.message });
    }
  }, [s.error, notify]);

  const on = s.enabled;
  // Error: off after a failed start (until the next tap), or on but unable to read aloud (it still listens; muted wins).
  const state = s.problem === "start" && !on ? "error" : !on ? "off" : s.status === "loading" ? "loading" : s.muted ? "muted" : s.problem ? "error" : s.speaking ? "speaking" : "listening";
  // Heard (M13): over listening, speaking, muted and can't-read-aloud, never over off, loading or a failed start.
  const heard = on && s.heard && state !== "loading" && state !== "off";
  const Icon = heard ? AudioLines : { off: MicOff, loading: Loader2, muted: VolumeX, speaking: Volume2, listening: Mic, error: TriangleAlert }[state];
  const words = heard ? "Heard" : { off: "", loading: "Starting", listening: "Listening", speaking: "Speaking", muted: "Muted", error: on ? "Listening, can't read aloud" : "Couldn't start" }[state];
  const id = React.useId();
  const toggle = (
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
      data-heard={heard ? "true" : undefined}
      className={cn(
        "flex h-11 flex-none cursor-pointer items-center gap-1.5 rounded-ui border-2 border-line px-2 shadow-hard-sm",
        state === "error" ? "bg-red-soft text-ink" : on ? "bg-acc text-onc" : "bg-base text-ink",
        className,
      )}
    >
      <Icon aria-hidden className={cn("size-5", state === "loading" && "motion-safe:animate-spin", heard && "motion-safe:animate-pulse")} strokeWidth={2.5} />
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
  if (!debug) return toggle;
  return (
    <>
      {toggle}
      <React.Suspense fallback={null}>
        <VoiceDiagnostics />
      </React.Suspense>
    </>
  );
}

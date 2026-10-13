// Hidden hands-free diagnostics (M13): only on the cook pages, only after `?voicedebug=1`. A small button next to the
// hands-free toggle opens a sheet with the last ~50 voice events (microphone, audio context, segments, transcriptions,
// commands, speech, model) and a Copy button, so the owner can paste the log back. Its own lazy chunk, not precached
// (vite.config.ts `globIgnores`), never loaded without the flag. No command list anywhere (owner rule).
import * as React from "react";
import { ScrollText } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { clearDiag, diagEvents, diagText, subscribeDiag, TALK_OVER_KEY } from "./diag";

type TalkOver = "auto" | "1" | "0";

function readTalkOver(): TalkOver {
  try {
    const v = localStorage.getItem(TALK_OVER_KEY);
    return v === "1" || v === "0" ? v : "auto";
  } catch {
    return "auto";
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older Safari or no clipboard permission: the selection fallback.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export default function VoiceDiagnostics() {
  const events = React.useSyncExternalStore(subscribeDiag, diagEvents, diagEvents);
  const [copied, setCopied] = React.useState<"" | "ok" | "failed">("");
  const [talkOver, setTalkOver] = React.useState<TalkOver>(readTalkOver);
  const listRef = React.useRef<HTMLOListElement>(null);

  React.useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [events]);

  const chooseTalkOver = (v: TalkOver) => {
    setTalkOver(v);
    try {
      if (v === "auto") localStorage.removeItem(TALK_OVER_KEY);
      else localStorage.setItem(TALK_OVER_KEY, v);
    } catch {
      /* not remembered */
    }
  };

  return (
    <Sheet onOpenChange={() => setCopied("")}>
      <SheetTrigger
        aria-label="Voice diagnostics"
        title="Voice diagnostics"
        data-testid="voice-diagnostics"
        className="grid size-11 flex-none cursor-pointer place-items-center rounded-ui border-2 border-line bg-base text-ink shadow-hard-sm"
      >
        <ScrollText aria-hidden className="size-5" strokeWidth={2.5} />
      </SheetTrigger>
      <SheetContent
        title="Voice diagnostics"
        description="The last hands-free events on this device, newest last."
        footer={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copyText(diagText()).then((ok) => setCopied(ok ? "ok" : "failed"))}
              className="h-11 cursor-pointer rounded-ui border-2 border-line bg-acc px-4 font-bold text-onc shadow-hard-sm"
            >
              Copy
            </button>
            <button type="button" onClick={clearDiag} className="h-11 cursor-pointer rounded-ui border-2 border-line bg-base px-4 font-bold text-ink shadow-hard-sm">
              Clear
            </button>
            <span role="status" className="text-sm text-sub">
              {copied === "ok" ? "Copied." : copied === "failed" ? "Couldn't copy: select the log and copy it." : `${events.length} events`}
            </span>
          </div>
        }
      >
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 font-mono text-[0.6875rem] font-bold tracking-[0.06rem] text-sub uppercase">Listen while reading aloud</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["auto", "Auto (not on iPhone)"],
                ["1", "Always"],
                ["0", "Never"],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-ui border-2 border-line bg-base px-3 text-sm font-semibold has-[:checked]:bg-acc has-[:checked]:text-onc">
                <input type="radio" name="talk-over" value={v} checked={talkOver === v} onChange={() => chooseTalkOver(v)} className="accent-ink" />
                {label}
              </label>
            ))}
          </div>
          <p className="m-0 text-sm text-sub">Applies the next time hands-free is switched on.</p>
        </fieldset>
        {events.length ? (
          <ol ref={listRef} aria-label="Voice events" className="m-0 flex list-none flex-col gap-1 p-0 font-mono text-[0.75rem] leading-snug">
            {events.map((e, i) => (
              <li key={`${e.at}-${i}`} className="rounded-ui border-2 border-line bg-base px-2 py-1 break-words">
                <span className="text-sub">{new Date(e.at).toISOString().slice(11, 23)}</span> <strong>{e.event}</strong>
                {e.detail ? <span> {e.detail}</span> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="m-0 text-sub">Nothing yet. Switch hands-free on and speak.</p>
        )}
      </SheetContent>
    </Sheet>
  );
}

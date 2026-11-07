// The household's own "Instructions for ChatGPT" (PRD R7.5, R11.19): added to the end of the copied PC Express list.
// One household value (`settings.chatgptInstructions`), edited on the Grocery page above Copy for ChatGPT and in
// Settings → Stores; both read the live household doc, so they stay in sync. Saved when the box loses focus.
import * as React from "react";
import { COPY_INSTRUCTIONS_MAX } from "@solving-food/core";
import { Textarea } from "@/components/ui/chip";
import { useNotify } from "@/components/notifications-context";
import { saveChatgptInstructions } from "@/data/plan";
import { cn } from "@/lib/utils";

export function ChatgptInstructions({ hid, saved, rows = 2, className }: { hid: string; saved: string; rows?: number; className?: string }) {
  const notify = useNotify();
  const [text, setText] = React.useState(saved);
  const [prev, setPrev] = React.useState(saved);
  if (saved !== prev) {
    setPrev(saved);
    setText(saved);
  }
  const save = () => {
    if (text.trim() === saved.trim()) return;
    saveChatgptInstructions(hid, text).catch((e) => notify({ kind: "error", message: `Couldn't save the instructions: ${(e as Error).message}` }));
  };
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="tabular-nums text-[0.625rem] font-bold tracking-[0.03rem]">Instructions for ChatGPT</span>
      <Textarea rows={rows} maxLength={COPY_INSTRUCTIONS_MAX} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} placeholder="e.g. Default to No Name or President's Choice brands if not specified." className="text-[0.8125rem]" />
    </label>
  );
}

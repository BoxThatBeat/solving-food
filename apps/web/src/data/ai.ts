// The LLM ingredient judge from the app (PRD R4.27, R4.35, R4.36): Gemini's status and the owner's key, and Check names.
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import type { PcxStatus } from "@solving-food/core";
import { functions } from "@/firebase/app";

export interface AiStatus extends PcxStatus {
  waiting: number;
}
export interface CheckReport {
  checked: number;
  merged: Array<{ from: string; into: string }>;
  kept: string[];
  unsure: string[];
  remaining: number;
  message?: string;
}

const STATUS_CHANGED = "ai-status-changed";
const changed = () => window.dispatchEvent(new Event(STATUS_CHANGED));

/** Saves the Gemini key (owner only; "" clears it); the status asks again. */
export async function setAiKey(hid: string, apiKey: string): Promise<PcxStatus> {
  const r = (await httpsCallable<{ hid: string; apiKey: string }, PcxStatus>(functions, "aiSetKey")({ hid, apiKey })).data;
  changed();
  return r;
}

/** Check names (owner only): Gemini judges the waiting names; sure ones are merged or kept. */
export async function checkIngredientNames(hid: string): Promise<CheckReport> {
  const r = (await httpsCallable<{ hid: string }, CheckReport>(functions, "checkIngredientNames", { timeout: 300_000 })({ hid })).data;
  changed();
  return r;
}

/** Gemini's status for this person (null while asking or offline). */
export function useAiStatus(hid: string | null): AiStatus | null {
  const [s, setS] = useState<{ hid: string; status: AiStatus } | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const again = () => setAsked((n) => n + 1);
    window.addEventListener(STATUS_CHANGED, again);
    return () => window.removeEventListener(STATUS_CHANGED, again);
  }, []);
  useEffect(() => {
    if (!hid) return;
    let live = true;
    httpsCallable<{ hid: string }, AiStatus>(functions, "aiStatus")({ hid })
      .then((r) => live && setS({ hid, status: r.data }))
      .catch(() => live && setS({ hid, status: { connected: false, waiting: 0, message: "Couldn't reach the server to check Gemini." } }));
    return () => {
      live = false;
    };
  }, [hid, asked]);
  return s?.hid === hid ? s.status : null;
}

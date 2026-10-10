import { useCallback, useEffect, useRef, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { normalizeTheme, type Theme } from "@solving-food/core";
import { db } from "@/firebase/app";
import { session } from "@/session/session";
import { useSession } from "@/session/useSession";
import { applyTheme, cachedTheme } from "./apply";

/**
 * The current theme and a setter that applies a change now and persists it to users/{uid}.theme (R11.9, per
 * user). Signed in, the user doc is the truth (latency-compensated); signed out, the localStorage mirror is.
 */
export function useTheme(): [Theme, (patch: Partial<Theme>) => Promise<void>] {
  const s = useSession();
  const [local, setLocal] = useState<Theme>(() => cachedTheme());
  const current = "profile" in s ? normalizeTheme(s.profile.theme) : local;
  // Two quick picks (flavour, then accent) must build on each other, not on a render that predates the first.
  const latest = useRef(current);
  const { flavour, accent } = current;
  useEffect(() => {
    latest.current = { flavour, accent };
  }, [flavour, accent]);

  const set = useCallback(async (patch: Partial<Theme>) => {
    const t = { ...latest.current, ...patch };
    latest.current = t;
    setLocal(t);
    applyTheme(t);
    const cur = session.get();
    if ("profile" in cur) await updateDoc(doc(db, "users", cur.user.uid), { theme: t });
  }, []);
  return [current, set];
}

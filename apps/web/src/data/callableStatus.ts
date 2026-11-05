// A callable's status for the household (Gemini, PC Express): asked once per page view and again whenever `event` fires
// on window (a key was saved). null while asking. One hook for both (M23).
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/app";

export function useCallableStatus<T>(hid: string | null, callable: string, event: string, unreachable: T): T | null {
  const [s, setS] = useState<{ hid: string; status: T } | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const again = () => setAsked((n) => n + 1);
    window.addEventListener(event, again);
    return () => window.removeEventListener(event, again);
  }, [event]);
  useEffect(() => {
    if (!hid) return;
    let live = true;
    httpsCallable<{ hid: string }, T>(functions, callable)({ hid })
      .then((r) => live && setS({ hid, status: r.data }))
      .catch(() => live && setS({ hid, status: unreachable }));
    return () => {
      live = false;
    };
    // `unreachable` is a constant per caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hid, asked, callable]);
  return s?.hid === hid ? s.status : null;
}

import { useEffect } from "react";
import { normalizeTheme } from "@solving-food/core";
import { useSession } from "@/session/useSession";
import { applyTheme } from "@/theme/apply";

/** Keeps <html>'s CSS variables in step with users/{uid}.theme. Mounted once at the root. */
export function ThemeSync(): null {
  const s = useSession();
  const t = "profile" in s ? s.profile.theme : null;
  const flavour = t?.flavour;
  const accent = t?.accent;
  useEffect(() => {
    if (flavour && accent) applyTheme(normalizeTheme({ flavour, accent }));
  }, [flavour, accent]);
  return null;
}

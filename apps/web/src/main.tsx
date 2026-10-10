import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import "./styles/index.css";
import { applyTheme, cachedTheme } from "./theme/apply";
import { session } from "./session/session";
import { router } from "./router";
import { initInstallPrompt } from "./pwa/install";
import { registerServiceWorker } from "./pwa/register";

applyTheme(cachedTheme());
initInstallPrompt();
session.start();

// Re-run route guards whenever the session moves between states (signed in, profile created, household joined…).
let last = "";
session.subscribe(() => {
  const s = session.get();
  const key = s.status === "ready" ? `ready:${s.activeHouseholdId}:${s.householdIds.join(",")}` : s.status;
  if (key !== last) {
    last = key;
    void router.invalidate();
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

registerServiceWorker();

import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import type { SessionStore } from "@/session/session";
import { NotificationsProvider } from "@/components/notifications";
import { ThemeSync } from "@/components/ThemeSync";

export interface RouterContext {
  session: SessionStore;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
  notFoundComponent: NotFound,
});

function Root() {
  return (
    <NotificationsProvider>
      <ThemeSync />
      <Outlet />
    </NotificationsProvider>
  );
}

function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="m-0 font-display text-4xl font-normal">Not found</h1>
        <a href="/" className="font-extrabold">
          Go home
        </a>
      </div>
    </div>
  );
}

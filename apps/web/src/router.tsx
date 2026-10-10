import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { session } from "./session/session";

export const router = createRouter({
  routeTree,
  context: { session },
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

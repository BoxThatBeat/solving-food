import { createRouter, defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { session } from "./session/session";

export const router = createRouter({
  routeTree,
  context: { session },
  // Collection filters are lists (core collectionSearchSchema); the default would JSON-encode them
  // (`cuisine=%5B%22greek%22%5D`). Comma lists read better and parse back through the same schema.
  stringifySearch: (search) =>
    defaultStringifySearch(Object.fromEntries(Object.entries(search).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v]))),
  parseSearch: defaultParseSearch,
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

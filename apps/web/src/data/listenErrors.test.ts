import { describe, expect, it } from "vitest";
import { bannerFor, codeOf, householdOf, onListenerError, reportListenerError } from "./listenErrors";

describe("listener errors", () => {
  it("reports to every sink with the error code", () => {
    const seen: string[] = [];
    const off = onListenerError((e) => seen.push(`${e.label}:${e.code}`));
    reportListenerError("households/h1/planItems?period=p", Object.assign(new Error("no"), { code: "permission-denied" }));
    off();
    reportListenerError("recipes/r1", new Error("later"));
    expect(seen).toEqual(["households/h1/planItems?period=p:permission-denied"]);
  });

  it("reads codes, households and banners", () => {
    expect(codeOf({ code: "unavailable" })).toBe("unavailable");
    expect(codeOf(new Error("x"))).toBe("unknown");
    expect(householdOf("households/h1/supply")).toBe("h1");
    expect(householdOf("households/h1?x")).toBe("h1");
    expect(householdOf("recipes/r1")).toBeNull();
    expect(bannerFor("permission-denied")?.kind).toBe("error");
    expect(bannerFor("unavailable")?.kind).toBe("info");
    expect(bannerFor("cancelled")).toBeNull();
  });
});

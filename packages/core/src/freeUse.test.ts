import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { freeUseIds } from "../../../data/scripts/free-use";

describe("data/free-use.json", () => {
  it("matches the seed's free-use ingredients (run `pnpm free-use:write`)", () => {
    const file = JSON.parse(readFileSync(new URL("../../../data/free-use.json", import.meta.url), "utf8")) as string[];
    expect(file).toEqual(freeUseIds());
  });
});

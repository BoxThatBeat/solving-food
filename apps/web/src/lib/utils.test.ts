import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps the base colour next to an arbitrary font size", () => {
    expect(cn("text-base text-[1.0625rem]")).toBe("text-base text-[1.0625rem]");
  });
  it("still merges conflicting colours and sizes", () => {
    expect(cn("text-ink", "text-base")).toBe("text-base");
    expect(cn("text-sm", "text-[2rem]")).toBe("text-[2rem]");
  });
});

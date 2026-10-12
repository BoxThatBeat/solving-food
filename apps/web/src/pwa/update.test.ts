import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyUpdate, isUpdatePending, onUpdateReady, resetUpdateStore, setUpdateDeferred } from "./update";

describe("app update store", () => {
  beforeEach(() => resetUpdateStore());

  it("applies a waiting update immediately when nothing defers it", () => {
    const apply = vi.fn();
    onUpdateReady(apply);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(isUpdatePending()).toBe(false);
  });

  it("holds the update while a cook session is on screen, then applies it when the session ends", () => {
    const apply = vi.fn();
    setUpdateDeferred(true);
    onUpdateReady(apply);
    expect(apply).not.toHaveBeenCalled();
    expect(isUpdatePending()).toBe(true);
    setUpdateDeferred(false);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("lets the banner apply a held update by hand", () => {
    const apply = vi.fn();
    setUpdateDeferred(true);
    onUpdateReady(apply);
    applyUpdate();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("does nothing when asked to apply with no update waiting", () => {
    expect(() => applyUpdate()).not.toThrow();
    expect(isUpdatePending()).toBe(false);
  });
});

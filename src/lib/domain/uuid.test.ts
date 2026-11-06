import { afterEach, describe, expect, it, vi } from "vitest";
import { newId } from "./uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
afterEach(() => vi.unstubAllGlobals());

describe("newId", () => {
  it("returns a v4 uuid with crypto.randomUUID, with getRandomValues only, and with neither", () => {
    expect(newId()).toMatch(V4);
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => a.fill(7) });
    expect(newId()).toMatch(V4);
    vi.stubGlobal("crypto", undefined);
    const a = newId();
    expect(a).toMatch(V4);
    expect(newId()).not.toBe(a);
  });
});

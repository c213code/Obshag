import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("createRepo", () => {
  it("returns an isolated mock repo on every call in mock mode (no singleton)", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "mock");
    vi.stubEnv("NODE_ENV", "test");
    const { createRepo } = await import("./index");
    const a = createRepo();
    const b = createRepo();
    expect(a).not.toBe(b);
    expect((await a.getMe()).display_name).toBe("Ерасыл");
    await a.createHousehold("Дача");
    expect(await a.listHouseholds()).toHaveLength(2);
    expect(await b.listHouseholds()).toHaveLength(1);
  });

  it("refuses mock mode in a production build", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "mock");
    vi.stubEnv("NODE_ENV", "production");
    const { createRepo } = await import("./index");
    expect(() => createRepo()).toThrow(/not allowed in production/);
  });

  it("is not implemented for supabase yet", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "supabase");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    const { createRepo } = await import("./index");
    expect(() => createRepo()).toThrow(/slice 1/);
  });
});

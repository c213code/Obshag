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
    await a.verifyOtp("erasyl@obshak.test", "000000");
    expect((await a.getMe())?.display_name).toBe("Ерасыл");
    await a.createHousehold("Дача");
    expect(await a.listHouseholds()).toHaveLength(2);
    // outside the browser each mock repo has its own memory store
    expect(await b.getSession()).toBeNull();
  });

  it("refuses mock mode in a production build", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "mock");
    vi.stubEnv("NODE_ENV", "production");
    const { createRepo } = await import("./index");
    expect(() => createRepo()).toThrow(/not allowed in production/);
  });

  it("builds the supabase repo when configured, and fails closed without config", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "supabase");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    const { createRepo } = await import("./index");
    expect(typeof createRepo().getSession).toBe("function");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.resetModules();
    const again = await import("./index");
    expect(() => again.createRepo()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});

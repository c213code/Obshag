import { afterEach, describe, expect, it, vi } from "vitest";
import { mockStoreEnabled } from "./mockStoreGate";

afterEach(() => vi.unstubAllEnvs());

const on = { E2E_ALLOW_MOCK_STORE: "1" };

describe("mockStoreEnabled", () => {
  it("needs the server-side opt-in, mock mode and the E2E flag", () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "mock");
    vi.stubEnv("NEXT_PUBLIC_E2E", "1");
    expect(mockStoreEnabled(on)).toBe(true);
    expect(mockStoreEnabled({})).toBe(false);
    expect(mockStoreEnabled({ E2E_ALLOW_MOCK_STORE: "true" })).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_E2E", "");
    expect(mockStoreEnabled(on)).toBe(false);
  });

  it("refuses to run when a Supabase URL is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "mock");
    vi.stubEnv("NEXT_PUBLIC_E2E", "1");
    expect(mockStoreEnabled({ ...on, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" })).toBe(false);
  });

  it("is off in supabase mode", () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "supabase");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "k");
    expect(mockStoreEnabled(on)).toBe(false);
  });
});

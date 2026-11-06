import { describe, expect, it } from "vitest";
import { isKitEnabled, parsePublicEnv } from "./public";

describe("parsePublicEnv", () => {
  it("accepts mock mode without secrets", () => {
    expect(parsePublicEnv({ NEXT_PUBLIC_DATA_MODE: "mock" }).NEXT_PUBLIC_DATA_MODE).toBe("mock");
  });
  it("treats empty strings as unset", () => {
    expect(parsePublicEnv({ NEXT_PUBLIC_DATA_MODE: "mock", NEXT_PUBLIC_SUPABASE_URL: "" }).NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
  });
  it("requires supabase vars outside mock mode (fail closed by default)", () => {
    expect(() => parsePublicEnv({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => parsePublicEnv({ NEXT_PUBLIC_DATA_MODE: "supabase" })).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
  it("accepts a complete supabase config", () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_DATA_MODE: "supabase",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
  });
  it("rejects invalid values", () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_DATA_MODE: "mock", NEXT_PUBLIC_SUPABASE_URL: "nope" })).toThrow(/Invalid environment/);
    expect(() => parsePublicEnv({ NEXT_PUBLIC_DATA_MODE: "other" })).toThrow();
  });
  it("refuses mock mode in production unless the E2E flag is set", () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_DATA_MODE: "mock" }, "production")).toThrow(/not allowed in production/);
    expect(parsePublicEnv({ NEXT_PUBLIC_DATA_MODE: "mock", NEXT_PUBLIC_E2E: "1" }, "production").NEXT_PUBLIC_E2E).toBe("1");
    expect(parsePublicEnv({ NEXT_PUBLIC_DATA_MODE: "mock" }, "development").NEXT_PUBLIC_DATA_MODE).toBe("mock");
  });
});

describe("isKitEnabled", () => {
  it("is on outside production and off in production without the E2E flag", () => {
    expect(isKitEnabled("development", undefined)).toBe(true);
    expect(isKitEnabled("production", undefined)).toBe(false);
    expect(isKitEnabled("production", "1")).toBe(true);
  });
});

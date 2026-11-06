import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("parseServerEnv", () => {
  it("requires the service role key only when asked", async () => {
    const { parseServerEnv } = await import("./server");
    expect(parseServerEnv({}, { requireServiceRole: false })).toEqual({});
    expect(() => parseServerEnv({}, { requireServiceRole: true })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(parseServerEnv({ SUPABASE_SERVICE_ROLE_KEY: "k" }, { requireServiceRole: true }).SUPABASE_SERVICE_ROLE_KEY).toBe("k");
  });
  it("validates the cron secret length", async () => {
    const { parseServerEnv } = await import("./server");
    expect(() => parseServerEnv({ CRON_SECRET: "short" }, { requireServiceRole: false })).toThrow(/Invalid server environment/);
  });
});

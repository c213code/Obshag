import { describe, expect, it } from "vitest";
import { postPaidOpened } from "./paidClient";

describe("postPaidOpened", () => {
  it("POSTs the pair with keepalive and reports 200 as true", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const ok = await postPaidOpened({ household_id: "h", to_user: "u" }, { "x-mock-user": "me" }, (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch);
    expect(ok).toBe(true);
    expect(seen).toMatchObject({ url: "/api/settle/opened", init: { method: "POST", keepalive: true, body: JSON.stringify({ household_id: "h", to_user: "u" }) } });
  });
  it("never throws: 409 and network errors are false", async () => {
    expect(await postPaidOpened({ household_id: "h", to_user: "u" }, {}, (async () => new Response("{}", { status: 409 })) as unknown as typeof fetch)).toBe(false);
    expect(await postPaidOpened({ household_id: "h", to_user: "u" }, {}, (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBe(false);
  });
});

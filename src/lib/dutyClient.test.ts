import { describe, expect, it } from "vitest";
import { postDutyNotify } from "./dutyClient";

describe("postDutyNotify", () => {
  it("posts the body with the headers and reports 200 as ok", async () => {
    let seen: { url: unknown; init: RequestInit } | null = null;
    const f = (async (url: unknown, init: RequestInit) => ((seen = { url, init }), new Response("{}", { status: 200 }))) as unknown as typeof fetch;
    expect(await postDutyNotify({ request_id: "r1", event: "requested" }, { "x-mock-user": "u1" }, f)).toBe(true);
    expect(seen!.url).toBe("/api/duty/notify");
    expect(JSON.parse(String(seen!.init.body))).toEqual({ request_id: "r1", event: "requested" });
    expect(seen!.init.headers).toMatchObject({ "x-mock-user": "u1" });
  });
  it("any other status or a network failure is false and never throws", async () => {
    expect(await postDutyNotify({ request_id: "r", event: "declined" }, {}, (async () => new Response("", { status: 403 })) as unknown as typeof fetch)).toBe(false);
    expect(await postDutyNotify({ request_id: "r", event: "declined" }, {}, (async () => Promise.reject(new Error("x"))) as unknown as typeof fetch)).toBe(false);
  });
});

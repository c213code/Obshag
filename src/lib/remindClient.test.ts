import { describe, expect, it } from "vitest";
import { cooldownParts, postRemind } from "./remindClient";

const reply = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  (async () => new Response(body === undefined ? null : JSON.stringify(body), { status, headers })) as unknown as typeof fetch;
const args = { household_id: "h", debtor_id: "d" };

describe("cooldownParts", () => {
  it("rounds hours up and switches to minutes under an hour", () => {
    expect(cooldownParts(6 * 3600)).toEqual({ unit: "h", n: 6 });
    expect(cooldownParts(5 * 3600 - 1)).toEqual({ unit: "h", n: 5 });
    expect(cooldownParts(3601)).toEqual({ unit: "h", n: 2 });
    expect(cooldownParts(3600)).toEqual({ unit: "m", n: 60 });
    expect(cooldownParts(41 * 60 - 30)).toEqual({ unit: "m", n: 41 });
    expect(cooldownParts(1)).toEqual({ unit: "m", n: 1 });
    expect(cooldownParts(Number.NaN)).toEqual({ unit: "h", n: 6 });
    expect(cooldownParts(99 * 3600)).toEqual({ unit: "h", n: 6 });
  });
});

describe("postRemind", () => {
  it("maps the route's answers", async () => {
    expect(await postRemind(args, {}, reply(200, { ok: true }))).toEqual({ ok: true });
    expect(await postRemind(args, {}, reply(409, { ok: false }))).toEqual({ ok: false, reason: "too_small" });
    expect(await postRemind(args, {}, reply(429, { ok: false, retry_after: 3600 }))).toEqual({ ok: false, reason: "cooldown", retryAfter: 3600 });
    expect(await postRemind(args, {}, reply(429, undefined, { "retry-after": "120" }))).toEqual({ ok: false, reason: "cooldown", retryAfter: 120 });
    expect(await postRemind(args, {}, reply(429, {}))).toMatchObject({ reason: "cooldown", retryAfter: 21600 });
    expect(await postRemind(args, {}, reply(403, { ok: false }))).toEqual({ ok: false, reason: "forbidden" });
    for (const s of [400, 401, 500]) expect(await postRemind(args, {}, reply(s, { ok: false }))).toEqual({ ok: false, reason: "failed" });
    expect(await postRemind(args, {}, reply(200, "<html>"))).toEqual({ ok: false, reason: "failed" });
    expect(await postRemind(args, {}, (async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).toEqual({ ok: false, reason: "failed" });
  });
  it("posts JSON with the given headers", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response('{"ok":true}', { status: 200 }))) as unknown as typeof fetch;
    await postRemind(args, { "x-mock-user": "u1" }, f);
    expect(seen!.url).toBe("/api/remind");
    expect(seen!.init.method).toBe("POST");
    expect(seen!.init.headers).toMatchObject({ "content-type": "application/json", "x-mock-user": "u1" });
    expect(JSON.parse(String(seen!.init.body))).toEqual(args);
  });
});

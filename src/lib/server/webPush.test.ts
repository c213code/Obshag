import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const send = vi.fn();
vi.mock("web-push", () => ({ sendNotification: (...args: unknown[]) => send(...args) }));

import { createWebPushSender, readVapid } from "./webPush";

const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/e", p256dh: "k", auth: "a" };
const payload = { type: "pending" as const, purchaseId: "p1", merchant: "Magnum", amount: 6000 };
const config = { publicKey: "pub", privateKey: "priv", subject: "mailto:a@b.kz" };

describe("readVapid", () => {
  it("needs all three values", () => {
    expect(readVapid({})).toBeNull();
    expect(readVapid({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b" })).toBeNull();
    expect(readVapid({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: " a ", VAPID_PRIVATE_KEY: "b", VAPID_SUBJECT: "mailto:x@y.kz" })).toEqual({
      publicKey: "a",
      privateKey: "b",
      subject: "mailto:x@y.kz",
    });
    expect(readVapid({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "b", VAPID_SUBJECT: "s" })).toBeNull();
  });
});

describe("createWebPushSender", () => {
  it("sends JSON with VAPID and reports ok", async () => {
    send.mockResolvedValueOnce({});
    expect(await createWebPushSender(config).send(sub, payload)).toEqual({ ok: true });
    const [target, body, options] = send.mock.calls[0];
    expect(target).toEqual({ endpoint: sub.endpoint, keys: { p256dh: "k", auth: "a" } });
    expect(JSON.parse(body)).toEqual(payload);
    expect(options.vapidDetails).toEqual({ subject: config.subject, publicKey: "pub", privateKey: "priv" });
  });
  it("passes a 5 s timeout and never contacts a host outside the allowlist", async () => {
    send.mockResolvedValueOnce({});
    await createWebPushSender(config).send(sub, payload);
    expect(send.mock.calls.at(-1)?.[2].timeout).toBe(5000);
    send.mockClear();
    expect(await createWebPushSender(config).send({ ...sub, endpoint: "https://169.254.169.254/x" }, payload)).toEqual({ ok: false, gone: true });
    expect(send).not.toHaveBeenCalled();
  });
  it("404 and 410 mean gone; other errors do not", async () => {
    for (const [statusCode, gone] of [[404, true], [410, true], [500, false], [429, false]] as const) {
      send.mockRejectedValueOnce(Object.assign(new Error("x"), { statusCode }));
      expect(await createWebPushSender(config).send(sub, payload)).toEqual({ ok: false, gone });
    }
    send.mockRejectedValueOnce(new Error("network"));
    expect(await createWebPushSender(config).send(sub, payload)).toEqual({ ok: false, gone: false });
  });
});

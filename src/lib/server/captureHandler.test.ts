import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRepo, memorySession, memoryStorage } from "@/lib/data/mockRepo";
import type { Repo } from "@/lib/data/repo";
import { handleCapture, parseChoice } from "./captureHandler";
import { createRecordingSender, type PushSender } from "./push";

let owner: Repo;
let token: string;
let householdId: string;
const storage = memoryStorage();

beforeEach(async () => {
  const fresh = memoryStorage();
  Object.assign(storage, fresh);
  owner = createMockRepo({ storage, session: memorySession() });
  await owner.signUp("a@x.kz", "password123");
  await owner.upsertProfile({ display_name: "Ерасыл", kaspi_phone: "+77001234567" });
  householdId = (await owner.createHousehold("Квартира")).id;
  token = await owner.rotateCaptureToken();
});

const deps = (push: PushSender | null = createRecordingSender()) => ({
  repo: createMockRepo({ storage, session: memorySession() }),
  push,
});

describe("handleCapture", () => {
  it("201 for a good token and a localized amount; the pending purchase has the parsed amount", async () => {
    const out = await handleCapture({ token, amount: "6 000,00 ₸", merchant: "Magnum" }, deps());
    expect(out.status).toBe(201);
    expect(out.body).toEqual({ ok: true });
    const [p] = await owner.listPending(householdId);
    expect(p).toMatchObject({ amount: 6000, merchant: "Magnum", status: "pending" });
  });

  it("400 for a malformed body, a missing token, and garbage, zero, negative or huge amounts", async () => {
    for (const body of [null, "x", {}, { token: "short", amount: 5 }, { token, amount: "abc" }, { token, amount: 0 }, { token, amount: "-5" }, { token, amount: 10_000_001 }, { token, amount: 5, merchant: "m".repeat(121) }, { amount: 5 }]) {
      const out = await handleCapture(body, deps());
      expect(out.status, JSON.stringify(body)).toBe(400);
      expect(out.body).toEqual({ ok: false });
    }
    expect(await owner.listPending(householdId)).toEqual([]);
  });

  it("401 for an unknown token, and the body says nothing about why", async () => {
    const out = await handleCapture({ token: "z".repeat(43), amount: 100 }, deps());
    expect(out).toMatchObject({ status: 401, body: { ok: false } });
  });

  it("429 on the 31st capture in an hour", async () => {
    for (let i = 0; i < 30; i++) expect((await handleCapture({ token, amount: 100 + i }, deps())).status).toBe(201);
    expect((await handleCapture({ token, amount: 1 }, deps())).status).toBe(429);
  });

  it("500 with no detail on anything unexpected", async () => {
    const out = await handleCapture({ token, amount: 100 }, { repo: { capture: async () => { throw new Error("db password leaked"); }, prunePushSubscription: async () => {} }, push: null });
    expect(out).toEqual({ status: 500, body: { ok: false } });
  });

  it("does not log the token or the body", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await handleCapture({ token, amount: 100 }, deps());
    await handleCapture({ token: "z".repeat(43), amount: 100 }, deps());
    await handleCapture({ token, amount: "junk" }, deps());
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });

  describe("push", () => {
    const sub = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, p256dh: "k", auth: "a" });

    it("sends one notification per device after the response, with the pending payload", async () => {
      await owner.savePushSubscription(sub(1));
      await owner.savePushSubscription(sub(2));
      const push = createRecordingSender();
      const out = await handleCapture({ token, amount: "6 000 ₸", merchant: "Magnum" }, deps(push));
      expect(push.calls).toHaveLength(0); // nothing before the response
      await out.afterResponse!();
      const [p] = await owner.listPending(householdId);
      expect(push.calls.map((c) => c.endpoint).sort()).toEqual([sub(1).endpoint, sub(2).endpoint]);
      expect(push.calls[0].payload).toEqual({ type: "pending", purchaseId: p.id, merchant: "Magnum", amount: 6000 });
    });

    it("prunes 404/410 endpoints through the token-gated RPC and keeps the others", async () => {
      await owner.savePushSubscription(sub(1));
      await owner.savePushSubscription(sub(2));
      const push = createRecordingSender({ gone: [sub(1).endpoint], failing: [sub(2).endpoint] });
      const d = deps(push);
      await (await handleCapture({ token, amount: 100 }, d)).afterResponse!();
      const next = await handleCapture({ token, amount: 101 }, deps(null));
      expect(next.afterResponse).toBeUndefined();
      const still = await createMockRepo({ storage, session: memorySession() }).capture(token, 102);
      expect(still.subscriptions.map((s) => s.endpoint)).toEqual([sub(2).endpoint]);
    });

    it("skips push silently without a sender or without subscriptions; the capture still succeeds", async () => {
      await owner.savePushSubscription(sub(1));
      const out = await handleCapture({ token, amount: 100 }, deps(null));
      expect(out.status).toBe(201);
      expect(out.afterResponse).toBeUndefined();
      const push = createRecordingSender();
      await owner.deletePushSubscription(sub(1).endpoint);
      expect((await handleCapture({ token, amount: 100 }, deps(push))).afterResponse).toBeUndefined();
    });

    it("a throwing sender never breaks the response or the other devices", async () => {
      await owner.savePushSubscription(sub(1));
      await owner.savePushSubscription(sub(2));
      const seen: string[] = [];
      const push = {
        async send(s: { endpoint: string }) {
          seen.push(s.endpoint);
          if (s.endpoint.endsWith("/1")) throw new Error("boom");
          return { ok: true as const };
        },
      };
      const out = await handleCapture({ token, amount: 100 }, deps(push));
      await expect(out.afterResponse!()).resolves.toBeUndefined();
      expect(seen).toHaveLength(2);
    });
  });

  describe("choice from the Shortcut menu", () => {
    const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/1", p256dh: "k", auth: "a" };

    it("parses English and Russian forms leniently; later is explicit, everything else is null", () => {
      for (const v of ["shared", " Shared ", "ОБЩЕЕ", "общее"]) expect(parseChoice(v), v).toBe("shared");
      for (const v of ["personal", "PERSONAL", "моё", "Моё ", "мое"]) expect(parseChoice(v), v).toBe("personal");
      for (const v of ["later", " Потом ", "ПОТОМ"]) expect(parseChoice(v), v).toBe("later");
      for (const v of ["", "  ", "yes", 1, null, undefined, {}]) expect(parseChoice(v), String(v)).toBeNull();
    });

    it("shared: created shared at once, split among the home members, no push", async () => {
      await owner.savePushSubscription(sub);
      const push = createRecordingSender();
      const out = await handleCapture({ token, amount: 1000, merchant: "Magnum", choice: "Общее" }, deps(push));
      expect(out).toMatchObject({ status: 201, body: { ok: true } });
      expect(out.afterResponse).toBeUndefined();
      expect(await owner.listPending(householdId)).toEqual([]);
      const [p] = await owner.listPurchases(householdId);
      expect(p).toMatchObject({ status: "shared", amount: 1000, description: "Magnum", source: "apple_pay" });
    });

    it("personal: created personal, no push", async () => {
      await owner.savePushSubscription(sub);
      const out = await handleCapture({ token, amount: 500, choice: "моё" }, deps(createRecordingSender()));
      expect(out.status).toBe(201);
      expect(out.afterResponse).toBeUndefined();
      expect(await owner.listPending(householdId)).toEqual([]);
      const [p] = await owner.listPurchases(householdId);
      expect(p).toMatchObject({ status: "personal", description: "Покупка" });
    });

    it("explicit later: pending, no instant push (the 19:00 digest asks)", async () => {
      await owner.savePushSubscription(sub);
      for (const [i, choice] of ["later", "потом", " Потом "].entries()) {
        const out = await handleCapture({ token, amount: 100 + i, choice }, deps(createRecordingSender()));
        expect(out, choice).toMatchObject({ status: 201, body: { ok: true } });
        expect(out.afterResponse, choice).toBeUndefined();
      }
      expect(await owner.listPending(householdId)).toHaveLength(3);
    });

    it("later reaches the repo as \"later\" (the DB tells it from no choice: no Telegram DM), junk as null", async () => {
      const capture = vi.fn(owner.capture);
      const repo = { capture, prunePushSubscription: owner.prunePushSubscription };
      await handleCapture({ token, amount: 100, choice: "Потом" }, { repo, push: null });
      await handleCapture({ token, amount: 101, choice: "xyz" }, { repo, push: null });
      await handleCapture({ token, amount: 102, choice: "общее" }, { repo, push: null });
      expect(capture.mock.calls.map((c) => c[3])).toEqual(["later", null, "shared"]);
    });

    it("no choice or junk (an old Shortcut): pending WITH the instant push, so nothing is lost", async () => {
      await owner.savePushSubscription(sub);
      for (const [i, choice] of [undefined, "", "xyz"].entries()) {
        const out = await handleCapture({ token, amount: 100 + i, choice }, deps(createRecordingSender()));
        expect(out.afterResponse, String(choice)).toBeDefined();
      }
      expect(await owner.listPending(householdId)).toHaveLength(3);
    });
  });
});

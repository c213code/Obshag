import { describe, expect, it } from "vitest";
import { createMockRepo, memorySession, memoryStorage } from "./mockRepo";
import { HOUSEHOLD_ID, SEED_PASSWORD, createSeed } from "./seed";
import type { Repo } from "./repo";

const [ME, AIDOS, DANYA, NURDA] = createSeed().profiles.map((p) => p.id);
const EMAIL: Record<string, string> = {
  [ME]: "erasyl@obshak.test",
  [AIDOS]: "aidos@obshak.test",
  [DANYA]: "danya@obshak.test",
  [NURDA]: createSeed().users.find((u) => u.id === NURDA)?.email ?? "",
};

function setup() {
  const storage = memoryStorage();
  const as = async (id: string): Promise<Repo> => {
    const r = createMockRepo({ storage, session: memorySession(), serverSecret: "unit-test-cron-secret-0123456789" });
    await r.signIn(EMAIL[id], SEED_PASSWORD);
    return r;
  };
  return { as };
}
const amountOf = (p: { shares: Array<{ debtor_id: string; amount: number }> }, u: string) => p.shares.find((s) => s.debtor_id === u)?.amount;

describe("mock orders (twin of 0016)", () => {
  it("3000 / four people / one order of 500: 625, 625, 625, 1125; the purchase lists the order", async () => {
    const me = await setup().as(ME);
    const p = await me.createPurchase({
      household_id: HOUSEHOLD_ID,
      amount: 3000,
      description: "Продукты",
      participant_ids: [ME, AIDOS, DANYA, NURDA],
      orders: [{ user_id: NURDA, amount: 500, note: "энергетик" }],
    });
    expect([ME, AIDOS, DANYA, NURDA].map((u) => amountOf(p, u))).toEqual([625, 625, 625, 1125]);
    expect(p.shares.find((s) => s.debtor_id === ME)?.settled_at).not.toBeNull();
    expect(p.orders).toEqual([{ purchase_id: p.id, user_id: NURDA, amount: 500, note: "энергетик" }]);
    expect((await me.listPurchases(HOUSEHOLD_ID)).find((x) => x.id === p.id)?.orders).toHaveLength(1);
  });

  it("rejects an order by the payer, a rest below the participants, and stores nothing", async () => {
    const me = await setup().as(ME);
    const before = (await me.listPurchases(HOUSEHOLD_ID)).length;
    const base = { household_id: HOUSEHOLD_ID, description: "x", participant_ids: [ME, AIDOS, DANYA, NURDA] };
    await expect(me.createPurchase({ ...base, amount: 3000, orders: [{ user_id: ME, amount: 500 }] })).rejects.toMatchObject({ code: "invalid" });
    await expect(me.createPurchase({ ...base, amount: 1000, orders: [{ user_id: NURDA, amount: 998 }] })).rejects.toMatchObject({ code: "invalid" });
    expect((await me.listPurchases(HOUSEHOLD_ID)).length).toBe(before);
  });

  it("resolves a pending capture as shared with orders", async () => {
    const env = setup();
    const me = await env.as(ME);
    const token = await me.rotateCaptureToken();
    const cap = await me.capture(token, 3000, "Magnum");
    const p = await me.resolvePending(cap.purchase_id, { shared: true, participant_ids: [ME, AIDOS, DANYA, NURDA], orders: [{ user_id: NURDA, amount: 500 }] });
    expect(amountOf(p, NURDA)).toBe(1125);
    expect(p.orders).toHaveLength(1);
  });

  it("update: payer or admin only, rebuilds the split, blocked after a payment, undone on bad input", async () => {
    const env = setup();
    const me = await env.as(ME);
    const p = await me.createPurchase({ household_id: HOUSEHOLD_ID, amount: 3000, description: "Продукты", participant_ids: [ME, AIDOS, DANYA, NURDA], orders: [{ user_id: NURDA, amount: 500 }] });
    const aidos = await env.as(AIDOS);
    await expect(aidos.updatePurchase(p.id, { amount: 3000, description: "x", payer_id: ME, participant_ids: [ME, AIDOS] })).rejects.toMatchObject({ code: "forbidden" });

    // a bad edit leaves the purchase untouched
    await expect(me.updatePurchase(p.id, { amount: 3000, description: "x", payer_id: AIDOS, participant_ids: [ME, AIDOS], orders: [{ user_id: AIDOS, amount: 10 }] })).rejects.toMatchObject({ code: "invalid" });
    const still = (await me.listPurchases(HOUSEHOLD_ID)).find((x) => x.id === p.id)!;
    expect(still.payer_id).toBe(ME);
    expect(still.shares).toHaveLength(4);
    expect(still.orders).toHaveLength(1);

    const u = await me.updatePurchase(p.id, { amount: 2000, description: "Правка", payer_id: AIDOS, participant_ids: [ME, AIDOS], orders: [{ user_id: DANYA, amount: 400 }] });
    expect(u).toMatchObject({ amount: 2000, description: "Правка", payer_id: AIDOS });
    expect([ME, AIDOS, DANYA].map((x) => amountOf(u, x))).toEqual([800, 800, 400]);
    expect(u.shares.find((s) => s.debtor_id === AIDOS)?.settled_at).not.toBeNull();

    const danya = await env.as(DANYA);
    await danya.markSettlement(HOUSEHOLD_ID, AIDOS);
    await expect(me.updatePurchase(p.id, { amount: 2000, description: "ещё", payer_id: AIDOS, participant_ids: [ME, AIDOS] })).rejects.toMatchObject({ code: "has_payments" });
  });
});

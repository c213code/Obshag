import { describe, expect, it } from "vitest";
import { createMockRepo, memorySession, memoryStorage } from "./mockRepo";
import type { Repo } from "./repo";
import { SEED_PASSWORD, createSeed } from "./seed";
import type { BillInput } from "./types";

const SECRET = "unit-test-cron-secret-0123456789";
const [ME, AIDOS, DANYA] = createSeed().profiles.map((p) => p.id);

function clock(start: string) {
  let t = Date.parse(start);
  return { now: () => new Date(t), set: (iso: string) => (t = Date.parse(iso)) };
}

/** A fresh household «Тест»: ME (admin), AIDOS and DANYA, no purchases. */
async function setup(start = "2026-11-03T08:00:00Z") {
  const storage = memoryStorage();
  const c = clock(start);
  const make = async (email: string) => {
    const r = createMockRepo({ storage, session: memorySession(), now: c.now, serverSecret: SECRET });
    await r.signIn(email, SEED_PASSWORD);
    return r;
  };
  const me = await make("erasyl@obshak.test");
  const aidos = await make("aidos@obshak.test");
  const danya = await make("danya@obshak.test");
  const h = await me.createHousehold("Тест");
  await aidos.joinHousehold(h.invite_code);
  await danya.joinHousehold(h.invite_code);
  const bill = (over: Partial<BillInput> = {}): BillInput => ({
    household_id: h.id, title: "Аренда", icon: "home", amount: 90000, variable: false, day_of_month: 1, payer_id: ME,
    participants: [ME, AIDOS, DANYA], ...over,
  });
  return { me, aidos, danya, h, c, bill };
}
const purchases = async (r: Repo, h: string) => r.listPurchases(h);

describe("mockRepo bills", () => {
  it("only an admin writes bills; members read them; input is validated", async () => {
    const { me, aidos, h, bill } = await setup();
    await expect(aidos.upsertBill(bill())).rejects.toMatchObject({ code: "forbidden" });
    const saved = await me.upsertBill(bill());
    expect(saved).toMatchObject({ title: "Аренда", amount: 90000, last_generated_month: null });
    expect((await aidos.listBills(h.id)).map((b) => b.id)).toEqual([saved.id]);
    await expect(aidos.deleteBill(saved.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(me.upsertBill(bill({ day_of_month: 29 }))).rejects.toMatchObject({ code: "invalid" });
    await expect(me.upsertBill(bill({ icon: "x" as never }))).rejects.toMatchObject({ code: "invalid" });
    await expect(me.upsertBill(bill({ amount: null }))).rejects.toMatchObject({ code: "invalid" });
    await expect(me.upsertBill(bill({ variable: true }))).rejects.toMatchObject({ code: "invalid" });
    await expect(me.upsertBill(bill({ participants: [] }))).rejects.toMatchObject({ code: "invalid" });
    await expect(me.upsertBill(bill({ payer_id: "stranger" }))).rejects.toMatchObject({ code: "invalid" });
    await expect(me.upsertBill(bill({ id: "nope" }))).rejects.toMatchObject({ code: "not_found" });
    const edited = await me.upsertBill(bill({ id: saved.id, title: "Аренда 2", payer_id: AIDOS }));
    expect(edited).toMatchObject({ id: saved.id, title: "Аренда 2", payer_id: AIDOS });
    await me.deleteBill(saved.id);
    expect(await me.listBills(h.id)).toEqual([]);
  });

  it("the cron creates a fixed bill's purchase once per month, equally split, and notifies for a variable one", async () => {
    const { me, h, c, bill } = await setup();
    await me.upsertBill(bill());
    const util = await me.upsertBill(bill({ title: "Коммуналка", amount: null, variable: true, day_of_month: 10, payer_id: AIDOS }));
    await expect(me.runMonthlyBills("wrong")).rejects.toMatchObject({ code: "unauthenticated" });
    const run = await me.runMonthlyBills(SECRET);
    expect(run).toEqual({ created: 1, notices: [] }); // 3rd: utilities are due on the 10th
    const list = await purchases(me, h.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ amount: 90000, description: "Аренда", source: "monthly", bill_month: "2026-11", payer_id: ME });
    expect(list[0].shares.map((s) => [s.debtor_id, s.amount, s.settled_at !== null])).toEqual([[ME, 30000, true], [AIDOS, 30000, false], [DANYA, 30000, false]]);
    expect((await me.runMonthlyBills(SECRET)).created).toBe(0);

    c.set("2026-11-10T08:00:00Z");
    const second = await me.runMonthlyBills(SECRET);
    expect(second.created).toBe(0);
    expect(second.notices).toEqual([expect.objectContaining({ to_user: AIDOS, bill_id: util.id, title: "Коммуналка", month: "2026-11" })]);
    expect(await purchases(me, h.id)).toHaveLength(1);

    c.set("2026-12-01T08:00:00Z");
    expect((await me.runMonthlyBills(SECRET)).created).toBe(1);
  });

  it("uses the Almaty day at the boundary", async () => {
    const { me, bill } = await setup("2026-11-04T18:59:59Z");
    await me.upsertBill(bill({ day_of_month: 5 }));
    expect((await me.runMonthlyBills(SECRET)).created).toBe(0);
    const { me: me2, bill: bill2 } = await setup("2026-11-04T19:00:00Z");
    await me2.upsertBill(bill2({ day_of_month: 5 }));
    expect((await me2.runMonthlyBills(SECRET)).created).toBe(1);
  });

  it("entering a variable bill's amount creates that month's purchase (payer or admin, once)", async () => {
    const { me, aidos, danya, c, bill } = await setup("2026-11-12T08:00:00Z");
    const util = await me.upsertBill(bill({ title: "Коммуналка", amount: null, variable: true, day_of_month: 10, payer_id: AIDOS }));
    await expect(danya.setBillAmount(util.id, "2026-11", 3000)).rejects.toMatchObject({ code: "forbidden" });
    await expect(aidos.setBillAmount(util.id, "2026-12", 3000)).rejects.toMatchObject({ code: "invalid" }); // future
    await expect(aidos.setBillAmount(util.id, "bad", 3000)).rejects.toMatchObject({ code: "invalid" });
    await expect(aidos.setBillAmount(util.id, "2026-11", 0)).rejects.toMatchObject({ code: "invalid" });
    const p = await aidos.setBillAmount(util.id, "2026-11", 31000);
    expect(p).toMatchObject({ amount: 31000, payer_id: AIDOS, bill_id: util.id, bill_month: "2026-11" });
    expect(p.shares).toHaveLength(3);
    await expect(aidos.setBillAmount(util.id, "2026-11", 5000)).rejects.toMatchObject({ code: "invalid" }); // already generated
    expect(await me.runMonthlyBills(SECRET)).toEqual({ created: 0, notices: [] });
    const fixed = await me.upsertBill(bill());
    await expect(me.setBillAmount(fixed.id, "2026-11", 1000)).rejects.toMatchObject({ code: "invalid" });
    c.set("2026-11-05T00:00:00Z");
    const early = await me.upsertBill(bill({ title: "Свет", amount: null, variable: true, day_of_month: 20 }));
    await expect(me.setBillAmount(early.id, "2026-11", 1000)).rejects.toMatchObject({ code: "invalid" }); // not due yet
  });

  it("deleting a bill keeps what it generated", async () => {
    const { me, h, bill } = await setup();
    const b = await me.upsertBill(bill());
    await me.runMonthlyBills(SECRET);
    await me.deleteBill(b.id);
    const list = await purchases(me, h.id);
    expect(list).toHaveLength(1);
    expect(list[0].bill_id).toBeNull();
  });
});

describe("mockRepo Квартира", () => {
  it("roles: admin only, the last admin stays", async () => {
    const { me, aidos, h } = await setup();
    await expect(aidos.setMemberRole(h.id, AIDOS, "admin")).rejects.toMatchObject({ code: "forbidden" });
    await expect(me.setMemberRole(h.id, ME, "member")).rejects.toMatchObject({ code: "invalid" });
    await expect(me.setMemberRole(h.id, "nobody", "admin")).rejects.toMatchObject({ code: "not_found" });
    await me.setMemberRole(h.id, AIDOS, "admin");
    await me.setMemberRole(h.id, ME, "member");
    expect((await aidos.listMembers(h.id)).map((m) => [m.user_id, m.role]).sort()).toEqual([[AIDOS, "admin"], [DANYA, "member"], [ME, "member"]].sort());
    await expect(aidos.setMemberRole(h.id, AIDOS, "member")).rejects.toMatchObject({ code: "invalid" });
  });

  it("removing and leaving are blocked by a non-zero net, then work", async () => {
    const { me, aidos, danya, h, bill } = await setup();
    const b = await me.upsertBill(bill({ payer_id: DANYA }));
    await me.createPurchase({ household_id: h.id, amount: 3000, description: "Хлеб", participant_ids: [ME, AIDOS] });
    await expect(danya.removeMember(h.id, AIDOS)).rejects.toMatchObject({ code: "forbidden" });
    await expect(me.removeMember(h.id, AIDOS)).rejects.toMatchObject({ code: "not_settled" });
    await expect(aidos.leaveHousehold(h.id)).rejects.toMatchObject({ code: "not_settled" });
    await expect(me.removeMember(h.id, ME)).rejects.toMatchObject({ code: "forbidden" });
    await expect(me.removeMember(h.id, "nobody")).rejects.toMatchObject({ code: "not_found" });
    // settle: Aidos pays Ерасыл, Ерасыл confirms
    const s = await aidos.markSettlement(h.id, ME);
    await me.confirmSettlement(s.id);
    await expect(me.leaveHousehold(h.id)).rejects.toMatchObject({ code: "invalid" }); // the only admin
    await me.removeMember(h.id, DANYA);
    const after = (await me.listBills(h.id)).find((x) => x.id === b.id)!;
    expect(after.participants).not.toContain(DANYA);
    expect(after.payer_id).toBe(ME);
    await aidos.leaveHousehold(h.id);
    expect((await me.listMembers(h.id)).map((m) => m.user_id)).toEqual([ME]);
    await expect(aidos.listMembers(h.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rotates the invite code (admin only) and the old one stops working", async () => {
    const { me, aidos, h } = await setup();
    await expect(aidos.rotateInviteCode(h.id)).rejects.toMatchObject({ code: "forbidden" });
    const fresh = await me.rotateInviteCode(h.id);
    expect(fresh.invite_code).toMatch(/^[A-Z0-9]{12}$/);
    expect(fresh.invite_code).not.toBe(h.invite_code);
    expect((await me.listHouseholds()).find((x) => x.id === h.id)?.invite_code).toBe(fresh.invite_code);
  });

  it("sets and clears away; past dates and strangers are refused", async () => {
    const { me, aidos, h } = await setup();
    await aidos.setAway(h.id, "2026-11-14");
    expect((await me.listMembers(h.id)).find((m) => m.user_id === AIDOS)?.away_until).toBe("2026-11-14");
    expect((await me.listMembers(h.id)).find((m) => m.user_id === ME)?.away_until).toBeNull();
    await expect(aidos.setAway(h.id, "2026-11-02")).rejects.toMatchObject({ code: "invalid" });
    await expect(aidos.setAway(h.id, "2030-01-01")).rejects.toMatchObject({ code: "invalid" });
    await expect(aidos.setAway(h.id, "tomorrow")).rejects.toMatchObject({ code: "invalid" });
    await aidos.setAway(h.id, null);
    expect((await me.listMembers(h.id)).find((m) => m.user_id === AIDOS)?.away_until).toBeNull();
    await expect(aidos.setAway("nope", null)).rejects.toMatchObject({ code: "forbidden" });
  });
});

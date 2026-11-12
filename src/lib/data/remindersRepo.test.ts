import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createMockRepo, memorySession, memoryStorage } from "./mockRepo";
import { RepoError } from "./repo";
import { createSupabaseRepo, mapDbError } from "./supabaseRepo";
import { HOUSEHOLD_ID, SEED_EMAIL, SEED_PASSWORD, createSeed } from "./seed";

const SECRET = "unit-test-cron-secret-0123456789";
const [ME, AIDOS, DANYA, NURIK] = createSeed().profiles.map((p) => p.id);

/** A clock the tests can move. Seeded purchases are from early November 2026. */
function clock(start = "2026-11-07T12:00:00Z") {
  let t = Date.parse(start);
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}
async function setup(email = SEED_EMAIL) {
  const storage = memoryStorage();
  const c = clock();
  const make = (session = memorySession()) => createMockRepo({ storage, session, now: c.now, serverSecret: SECRET });
  const repo = make();
  await repo.signIn(email, SEED_PASSWORD);
  return { storage, c, make, repo };
}
async function as(make: (session?: ReturnType<typeof memorySession>) => ReturnType<typeof createMockRepo>, email: string) {
  const r = make();
  await r.signIn(email, SEED_PASSWORD);
  return r;
}

describe("mockRepo reminders", () => {
  it("remind needs the server secret", async () => {
    const { repo } = await setup();
    await expect(repo.remind("wrong", HOUSEHOLD_ID, AIDOS)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(repo.remind("", HOUSEHOLD_ID, AIDOS)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(repo.runDailyReminders("wrong")).rejects.toMatchObject({ code: "unauthenticated" });
    const noSecret = createMockRepo({ session: memorySession(ME) });
    await expect(noSecret.runDailyReminders(SECRET)).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("a creditor reminds a debtor once per 6 hours per pair", async () => {
    const { repo, c } = await setup();
    const t = await repo.remind(SECRET, HOUSEHOLD_ID, AIDOS);
    expect(t).toMatchObject({ to_user: AIDOS, from_user: ME, from_name_dative: "Ерасыл", amount: 1000 });
    const err = await repo.remind(SECRET, HOUSEHOLD_ID, AIDOS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepoError);
    expect(err).toMatchObject({ code: "rate_limited", retryAfter: 6 * 3600 });
    c.advance(5 * 3600_000);
    await expect(repo.remind(SECRET, HOUSEHOLD_ID, AIDOS)).rejects.toMatchObject({ code: "rate_limited", retryAfter: 3600 });
    await expect(repo.remind(SECRET, HOUSEHOLD_ID, DANYA)).resolves.toMatchObject({ to_user: DANYA });
    c.advance(3601_000);
    await expect(repo.remind(SECRET, HOUSEHOLD_ID, AIDOS)).resolves.toMatchObject({ amount: 1000 });
  });

  it("forbids a debtor, yourself and strangers", async () => {
    const { make, repo } = await setup();
    const aidos = await as(make, "aidos@obshak.test");
    await expect(aidos.remind(SECRET, HOUSEHOLD_ID, ME)).rejects.toMatchObject({ code: "forbidden" });
    await expect(repo.remind(SECRET, HOUSEHOLD_ID, ME)).rejects.toMatchObject({ code: "forbidden" });
    await expect(repo.remind(SECRET, HOUSEHOLD_ID, "nobody")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("the daily run reminds each old net debt once, skips opt-outs and the cooldown", async () => {
    const { make, repo, c } = await setup();
    const first = await repo.runDailyReminders(SECRET);
    // Aidos owes Erasyl 1500 - 500; Danya and Nurik owe Erasyl 1500 and Aidos 500; nobody owes the other way round
    expect(first.map((r) => [r.to_user, r.from_user, r.amount]).sort()).toEqual(
      [
        [AIDOS, ME, 1000],
        [DANYA, ME, 1500],
        [DANYA, AIDOS, 500],
        [NURIK, ME, 1500],
        [NURIK, AIDOS, 500],
      ].sort(),
    );
    expect(await repo.runDailyReminders(SECRET)).toEqual([]);
    c.advance(7 * 3600_000);
    const danya = await as(make, "danya@obshak.test");
    await danya.setRemindersEnabled(HOUSEHOLD_ID, false);
    const again = await repo.runDailyReminders(SECRET);
    expect(again.some((r) => r.to_user === DANYA)).toBe(false);
    expect(again.some((r) => r.to_user === NURIK)).toBe(true);
  });

  it("skips debts younger than 24h", async () => {
    const storage = memoryStorage();
    const early = clock("2026-11-04T01:00:00Z");
    const repo = createMockRepo({ storage, session: memorySession(), now: early.now, serverSecret: SECRET });
    await repo.signIn(SEED_EMAIL, SEED_PASSWORD);
    // seeded purchases are from 2026-11-03 12:00 and 11-04 12:00 UTC: the first is 13h old, the second is in the future
    expect(await repo.runDailyReminders(SECRET)).toEqual([]);
  });
});

describe("mockRepo custom purchases, delete and edit", () => {
  it("stores 3000/2000/1000 and settles only the payer's entry", async () => {
    const { repo } = await setup();
    const p = await repo.createPurchaseCustom({
      household_id: HOUSEHOLD_ID,
      amount: 6000,
      description: "Ужин",
      shares: [{ user_id: ME, amount: 3000 }, { user_id: AIDOS, amount: 2000 }, { user_id: DANYA, amount: 1000 }],
    });
    expect(p.shares.map((s) => [s.debtor_id, s.amount, s.settled_at !== null])).toEqual([
      [ME, 3000, true],
      [AIDOS, 2000, false],
      [DANYA, 1000, false],
    ]);
  });

  it("validates sums, duplicates, members and the payer-only entry", async () => {
    const { repo } = await setup();
    const base = { household_id: HOUSEHOLD_ID, amount: 6000, description: "Ужин" };
    await expect(repo.createPurchaseCustom({ ...base, shares: [{ user_id: AIDOS, amount: 5999 }] })).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.createPurchaseCustom({ ...base, shares: [{ user_id: AIDOS, amount: 3000 }, { user_id: AIDOS, amount: 3000 }] })).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.createPurchaseCustom({ ...base, shares: [{ user_id: ME, amount: 6000 }] })).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.createPurchaseCustom({ ...base, shares: [{ user_id: "stranger", amount: 6000 }] })).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.createPurchaseCustom({ ...base, shares: [{ user_id: AIDOS, amount: 6000.5 }] })).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.createPurchaseCustom({ ...base, household_id: "other", shares: [{ user_id: AIDOS, amount: 6000 }] })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("deletes an untouched purchase, blocks it after a payment (a mark is final)", async () => {
    const { repo, make } = await setup();
    const p = await repo.createPurchaseCustom({ household_id: HOUSEHOLD_ID, amount: 1000, description: "Чай", shares: [{ user_id: AIDOS, amount: 1000 }] });
    const before = (await repo.listPurchases(HOUSEHOLD_ID)).length;
    await repo.deletePurchase(p.id);
    expect((await repo.listPurchases(HOUSEHOLD_ID)).length).toBe(before - 1);
    await expect(repo.deletePurchase(p.id)).rejects.toMatchObject({ code: "not_found" });

    const q = await repo.createPurchaseCustom({ household_id: HOUSEHOLD_ID, amount: 1000, description: "Кофе", shares: [{ user_id: AIDOS, amount: 1000 }] });
    const aidos = await as(make, "aidos@obshak.test");
    await expect(aidos.deletePurchase(q.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(aidos.updatePurchaseDescription(q.id, "x")).rejects.toMatchObject({ code: "forbidden" });
    await aidos.markSettlement(HOUSEHOLD_ID, ME); // slice 22: final at once, the paid purchase is locked for good
    await expect(repo.deletePurchase(q.id)).rejects.toMatchObject({ code: "has_payments" });

    // a seeded purchase whose share Danya has settled
    const seeded = (await repo.listPurchases(HOUSEHOLD_ID)).find((x) => x.description === "Продукты")!;
    const danya = await as(make, "danya@obshak.test");
    await danya.markSettlement(HOUSEHOLD_ID, ME);
    await expect(repo.deletePurchase(seeded.id)).rejects.toMatchObject({ code: "has_payments" });
  });

  it("edits the description (payer only, 1..200)", async () => {
    const { repo } = await setup();
    const seeded = (await repo.listPurchases(HOUSEHOLD_ID)).find((x) => x.description === "Продукты")!;
    expect((await repo.updatePurchaseDescription(seeded.id, "  Хлеб ")).description).toBe("Хлеб");
    await expect(repo.updatePurchaseDescription(seeded.id, "   ")).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.updatePurchaseDescription(seeded.id, "я".repeat(201))).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.updatePurchaseDescription("nope", "x")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("supabaseRepo (new RPCs)", () => {
  function fake(rpc: Record<string, { data: unknown; error: { code?: string; message?: string; hint?: string } | null }>) {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const client = {
      rpc: async (fn: string, args: unknown) => {
        calls.push({ fn, args });
        return rpc[fn] ?? { data: null, error: null };
      },
    } as unknown as SupabaseClient;
    return { repo: createSupabaseRepo(client), calls };
  }

  it("calls the RPCs with the migration's parameter names", async () => {
    const row = { id: "p1", household_id: "h1", payer_id: "u1", amount: 100, description: "x", merchant: null, source: "manual", status: "shared", created_at: "t", shares: [] };
    const target = { to_user: "u2", from_user: "u1", from_name_dative: "Ерасыл", amount: 5, subscriptions: [] };
    const { repo, calls } = fake({
      create_purchase_custom: { data: row, error: null },
      update_purchase_description: { data: row, error: null },
      remind: { data: target, error: null },
      run_daily_reminders: { data: [target], error: null },
    });
    await repo.createPurchaseCustom({ household_id: "h1", amount: 100, description: " x ", shares: [{ user_id: "u2", amount: 100 }] });
    await repo.deletePurchase("p1");
    await repo.updatePurchaseDescription("p1", " y ");
    await repo.setRemindersEnabled("h1", false);
    expect(await repo.remind("s", "h1", "u2")).toEqual(target);
    expect(await repo.runDailyReminders("s")).toEqual([target]);
    expect(calls).toEqual([
      { fn: "create_purchase_custom", args: { p_household: "h1", p_amount: 100, p_description: "x", p_merchant: null, p_shares: [{ user_id: "u2", amount: 100 }] } },
      { fn: "delete_purchase", args: { p_id: "p1" } },
      { fn: "update_purchase_description", args: { p_id: "p1", p_text: "y" } },
      { fn: "set_reminders_enabled", args: { p_household: "h1", p_enabled: false } },
      { fn: "remind", args: { p_secret: "s", p_household: "h1", p_debtor: "u2" } },
      { fn: "run_daily_reminders", args: { p_secret: "s" } },
    ]);
    await expect(repo.createPurchaseCustom({ household_id: "h1", amount: 100, description: "x", shares: [{ user_id: "u2", amount: 99 }] })).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.updatePurchaseDescription("p1", " ")).rejects.toMatchObject({ code: "invalid" });
  });

  it("maps has_payments, the cooldown hint and failures", async () => {
    expect(mapDbError({ code: "23514", message: "has_payments" }).code).toBe("has_payments");
    const cooldown = mapDbError({ code: "P0001", message: "rate_limited", hint: "3600" });
    expect(cooldown).toMatchObject({ code: "rate_limited", retryAfter: 3600 });
    expect(mapDbError({ code: "P0001", message: "rate_limited", hint: "soon" }).retryAfter).toBeUndefined();
    const { repo } = fake({
      delete_purchase: { data: null, error: { code: "23514", message: "has_payments" } },
      set_reminders_enabled: { data: null, error: { code: "42501", message: "x" } },
      remind: { data: null, error: { code: "42501", message: "x" } },
    });
    await expect(repo.deletePurchase("p1")).rejects.toMatchObject({ code: "has_payments" });
    await expect(repo.setRemindersEnabled("h1", true)).rejects.toMatchObject({ code: "forbidden" });
    await expect(repo.remind("s", "h", "d")).rejects.toMatchObject({ code: "forbidden" });
  });
});

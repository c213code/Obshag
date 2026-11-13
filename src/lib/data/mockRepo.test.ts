import { describe, expect, it } from "vitest";
import { createMockRepo, memorySession, memoryStorage } from "./mockRepo";
import { MockConflictError } from "./mockDb";
import { repoContract } from "./repoContract";
import { RepoError } from "./repo";
import { HOUSEHOLD_ID, ME_ID, SEED_EMAIL, SEED_PASSWORD, createSeed } from "./seed";

repoContract("mockRepo", async () => {
  const storage = memoryStorage();
  return [createMockRepo({ storage, session: memorySession() }), createMockRepo({ storage, session: memorySession() })];
});

describe("mockRepo setMemberAway", () => {
  it("a housemate marks another away and back home; strangers and bad dates are refused", async () => {
    const repo = createMockRepo();
    await repo.signIn(SEED_EMAIL, SEED_PASSWORD);
    const members = await repo.listMembers(HOUSEHOLD_ID);
    const other = members.find((m) => m.user_id !== ME_ID)!;
    const until = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await repo.setMemberAway(HOUSEHOLD_ID, other.user_id, until);
    expect((await repo.listMembers(HOUSEHOLD_ID)).find((m) => m.user_id === other.user_id)?.away_until).toBe(until);
    await repo.setMemberAway(HOUSEHOLD_ID, other.user_id, null);
    expect((await repo.listMembers(HOUSEHOLD_ID)).find((m) => m.user_id === other.user_id)?.away_until).toBeNull();
    await expect(repo.setMemberAway(HOUSEHOLD_ID, other.user_id, "2001-01-01")).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.setMemberAway(HOUSEHOLD_ID, "nobody", until)).rejects.toMatchObject({ code: "forbidden" });
    await expect(repo.setMemberAway("no-house", other.user_id, until)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("mockRepo seed and persistence", () => {
  it("signs the seeded user into the demo household with four members", async () => {
    const repo = createMockRepo();
    await repo.signIn(SEED_EMAIL, SEED_PASSWORD);
    expect((await repo.getMe())?.display_name).toBe("Ерасыл");
    const [h] = await repo.listHouseholds();
    expect(h.name).toBe("Квартира 42");
    const members = await repo.listMembers(HOUSEHOLD_ID);
    expect(members.map((m) => m.profile.display_name)).toEqual(["Ерасыл", "Айдос", "Даня", "Нурик"]);
  });

  it("hides other people's personal purchases and sorts newest first", async () => {
    const repo = createMockRepo();
    await repo.signIn(SEED_EMAIL, SEED_PASSWORD);
    const list = await repo.listPurchases(HOUSEHOLD_ID);
    expect(list.every((p) => p.status !== "personal")).toBe(true);
    expect(list[0].created_at >= list[list.length - 1].created_at).toBe(true);
  });

  it("persists through storage: a new repo on the same storage sees earlier writes", async () => {
    const storage = memoryStorage();
    const session = memorySession();
    const one = createMockRepo({ storage, session });
    await one.signIn(SEED_EMAIL, SEED_PASSWORD);
    await one.createHousehold("Дача");
    const two = createMockRepo({ storage, session });
    expect((await two.listHouseholds()).map((h) => h.name)).toEqual(["Квартира 42", "Дача"]);
  });

  it("shares the seeded split: payer share settled, the rest open", async () => {
    const repo = createMockRepo();
    await repo.signIn(SEED_EMAIL, SEED_PASSWORD);
    const created = await repo.createPurchase({
      household_id: HOUSEHOLD_ID,
      amount: 6000,
      description: "Хлеб",
      participant_ids: createSeed().profiles.map((p) => p.id),
    });
    expect(created.shares.map((s) => s.amount)).toEqual([1500, 1500, 1500, 1500]);
    expect(created.shares[0]).toMatchObject({ debtor_id: ME_ID });
    expect(created.shares[0].settled_at).not.toBeNull();
    expect(created.shares.slice(1).every((s) => s.settled_at === null)).toBe(true);
  });

  it("rate limit window slides: attempts older than an hour stop counting", async () => {
    let t = Date.parse("2026-11-06T10:00:00Z");
    const storage = memoryStorage();
    const a = createMockRepo({ storage, session: memorySession(), now: () => new Date(t) });
    await a.signUp("a@x.kz", "password123");
    await a.upsertProfile({ display_name: "А", kaspi_phone: "+77001234567" });
    for (let i = 0; i < 10; i++) await a.joinHousehold(`BAD0000000${i}`).catch(() => undefined);
    await expect(a.joinHousehold("KV42AB7K9M3X")).rejects.toBeInstanceOf(RepoError);
    t += 61 * 60 * 1000;
    await expect(a.joinHousehold("KV42AB7K9M3X")).resolves.toMatchObject({ id: HOUSEHOLD_ID });
  });

  it("validates emails and profile fields", async () => {
    const repo = createMockRepo();
    await expect(repo.signUp("nope", "password123")).rejects.toMatchObject({ code: "invalid" });
    await repo.signUp("c@x.kz", "password123");
    await expect(repo.upsertProfile({ display_name: "", kaspi_phone: "+77001234567" })).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.upsertProfile({ display_name: "C", kaspi_phone: "123" })).rejects.toMatchObject({ code: "invalid" });
    const p = await repo.upsertProfile({ display_name: "C", kaspi_phone: "8 700 123 45 67" });
    expect(p.kaspi_phone).toBe("+77001234567");
    const again = await repo.upsertProfile({ display_name: "Си", kaspi_phone: "+77001234567" });
    expect(again).toMatchObject({ id: p.id, display_name: "Си", avatar_color: p.avatar_color });
    expect(await repo.getSession()).toMatchObject({ email: "c@x.kz" });
  });

  it("reactivates a member who left when they join again", async () => {
    const storage = memoryStorage();
    const repo = createMockRepo({ storage, session: memorySession() });
    await repo.signUp("a@x.kz", "password123");
    await repo.upsertProfile({ display_name: "А", kaspi_phone: "+77001234567" });
    const h = await repo.createHousehold("Дача");
    const { rev, db } = (await storage.load())!;
    // the creator is an admin; they left and were "away"
    Object.assign(db.members[db.members.length - 1], { active: false, away_until: "2026-12-01" });
    await storage.save(db, rev);
    expect(await repo.listHouseholds()).toEqual([]);
    await repo.joinHousehold(h.invite_code);
    expect(await repo.listHouseholds()).toHaveLength(1);
    // coming back never restores the old admin role or the away period
    const [me] = await repo.listMembers(h.id);
    expect(me).toMatchObject({ role: "member", active: true, away_until: null });
  });

  it("an active admin typing the code again keeps the role", async () => {
    const repo = createMockRepo();
    await repo.signUp("a@x.kz", "password123");
    await repo.upsertProfile({ display_name: "А", kaspi_phone: "+77001234567" });
    const h = await repo.createHousehold("Дача");
    await repo.joinHousehold(h.invite_code);
    expect((await repo.listMembers(h.id))[0].role).toBe("admin");
  });

  it("concurrent writes through one repo are serialized: no lost updates", async () => {
    const storage = memoryStorage();
    const repo = createMockRepo({ storage, session: memorySession() });
    await repo.signUp("a@x.kz", "password123");
    await repo.upsertProfile({ display_name: "А", kaspi_phone: "+77001234567" });
    const h = await repo.createHousehold("Дача");
    const me = (await repo.getMe())!;
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        repo.createPurchase({ household_id: h.id, amount: 100 + i, description: `p${i}`, participant_ids: [me.id] }),
      ),
    );
    expect(await repo.listPurchases(h.id)).toHaveLength(8);
  });

  it("two devices writing at the same time both land (conflicts retry on fresh data)", async () => {
    const storage = memoryStorage();
    const a = createMockRepo({ storage, session: memorySession() });
    const b = createMockRepo({ storage, session: memorySession() });
    for (const [r, mail] of [[a, "a@x.kz"], [b, "b@x.kz"]] as const) {
      await r.signUp(mail, "password123");
    }
    await Promise.all([
      a.upsertProfile({ display_name: "А", kaspi_phone: "+77001234567" }),
      b.upsertProfile({ display_name: "Б", kaspi_phone: "+77007654321" }),
    ]);
    const db = (await storage.load())!.db;
    expect(db.profiles.map((p) => p.display_name)).toEqual(expect.arrayContaining(["А", "Б"]));
  });

  it("a stale save is refused with a conflict", async () => {
    const storage = memoryStorage();
    const first = (await storage.load()) ?? { rev: 0, db: createSeed() };
    await storage.save(first.db, 0);
    await expect(storage.save(first.db, 0)).rejects.toBeInstanceOf(MockConflictError);
    await storage.save(first.db, 1);
  });
});

describe("mockRepo settlements: the recorded set (legacy marked rows)", () => {
  async function marked() {
    const storage = memoryStorage();
    const a = createMockRepo({ storage, session: memorySession() });
    const b = createMockRepo({ storage, session: memorySession() });
    await a.signIn(SEED_EMAIL, SEED_PASSWORD);
    await b.signIn("aidos@obshak.test", SEED_PASSWORD);
    // seed: Ерасыл paid 6000 (Айдос owes 1500), Айдос paid 2000 (Ерасыл owes 500): Айдос owes Ерасыл 1000 net
    const done = await b.markSettlement(HOUSEHOLD_ID, ME_ID);
    expect(done.status).toBe("confirmed"); // slice 22: the mark is final
    // a legacy «marked» row (made before slice 22) is put back by hand: the old creditor-confirm path must stay safe
    const { rev, db } = (await storage.load())!;
    const row = db.settlements.find((x) => x.id === done.id)!;
    row.status = "marked";
    row.confirmed_at = null;
    for (const sh of db.shares) if (sh.settlement_id === done.id) Object.assign(sh, { settled_at: null, settlement_id: null });
    await storage.save(db, rev);
    const s = (await b.listSettlements(HOUSEHOLD_ID)).find((x) => x.id === done.id)!;
    return { storage, a, b, s };
  }

  it("seeded users sign in with password123; a wrong password is refused", async () => {
    const repo = createMockRepo();
    await expect(repo.signIn(SEED_EMAIL, "nope-nope")).rejects.toMatchObject({ code: "invalid_credentials" });
    expect((await repo.signIn(SEED_EMAIL, SEED_PASSWORD)).user_id).toBe(ME_ID);
  });

  it("confirm is stale when a recorded purchase was deleted: nothing closes, cancel and mark again work", async () => {
    const { storage, a, b, s } = await marked();
    expect(s.amount).toBe(1000);
    const { rev, db } = (await storage.load())!;
    db.purchases = db.purchases.filter((p) => p.description !== "Вода");
    db.shares = db.shares.filter((x) => x.purchase_id !== "20000000-0000-4000-8000-000000000002");
    await storage.save(db, rev);
    await expect(a.confirmSettlement(s.id)).rejects.toMatchObject({ code: "stale" });
    const open = (await a.listPurchases(HOUSEHOLD_ID)).flatMap((p) => p.shares.filter((x) => x.settlement_id !== null));
    expect(open).toEqual([]);
    await b.cancelSettlement(s.id);
    expect((await b.markSettlement(HOUSEHOLD_ID, ME_ID)).amount).toBe(1500);
  });

  it("a purchase that turned shared after the mark stays open after the confirm", async () => {
    const { storage, a, s } = await marked();
    const { rev, db } = (await storage.load())!;
    db.purchases.push({
      id: "20000000-0000-4000-8000-0000000000aa",
      household_id: HOUSEHOLD_ID,
      payer_id: ME_ID,
      amount: 400,
      description: "Ожидало",
      merchant: null,
      source: "apple_pay",
      status: "shared",
      created_at: "2026-11-01T00:00:00.000Z", // older than the mark, but never recorded
    });
    db.shares.push({ purchase_id: "20000000-0000-4000-8000-0000000000aa", debtor_id: s.from_id, amount: 400, settled_at: null, settlement_id: null });
    await storage.save(db, rev);
    await a.confirmSettlement(s.id);
    const open = (await a.listPurchases(HOUSEHOLD_ID)).flatMap((p) => p.shares.filter((x) => x.settled_at === null && x.debtor_id === s.from_id));
    expect(open.map((x) => x.amount)).toEqual([400]);
  });
});

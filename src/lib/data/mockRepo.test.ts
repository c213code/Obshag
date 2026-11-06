import { describe, expect, it } from "vitest";
import { createMockRepo } from "./mockRepo";
import { RepoError } from "./repo";
import { HOUSEHOLD_ID, ME_ID } from "./seed";

describe("mockRepo", () => {
  it("returns me and the seeded household with four members", async () => {
    const repo = createMockRepo();
    expect((await repo.getMe()).display_name).toBe("Ерасыл");
    const [h] = await repo.listHouseholds();
    expect(h.name).toBe("Квартира 42");
    const members = await repo.listMembers(HOUSEHOLD_ID);
    expect(members.map((m) => m.profile.display_name)).toEqual(["Ерасыл", "Айдос", "Даня", "Нурик"]);
  });

  it("hides other people's personal purchases", async () => {
    const repo = createMockRepo();
    const list = await repo.listPurchases(HOUSEHOLD_ID);
    expect(list.every((p) => p.status !== "personal")).toBe(true);
    expect(list[0].created_at >= list[list.length - 1].created_at).toBe(true);
  });

  it("creates a household with me as admin and a fresh invite code", async () => {
    const repo = createMockRepo();
    const h = await repo.createHousehold("  Дача ");
    expect(h.name).toBe("Дача");
    expect(h.invite_code).toMatch(/^[A-Z2-9]{12}$/);
    expect(await repo.listHouseholds()).toHaveLength(2);
    const members = await repo.listMembers(h.id);
    expect(members[0]).toMatchObject({ user_id: ME_ID, role: "admin" });
    await expect(repo.createHousehold("   ")).rejects.toMatchObject({ code: "invalid" });
  });

  it("joins by invite code, case-insensitively and idempotently", async () => {
    const repo = createMockRepo();
    const h = await repo.joinHousehold(" kv42ab7k9m3x ");
    expect(h.id).toBe(HOUSEHOLD_ID);
    expect(await repo.listMembers(HOUSEHOLD_ID)).toHaveLength(4);
    await expect(repo.joinHousehold("NOPE0000000000")).rejects.toBeInstanceOf(RepoError);
  });

  it("creates a purchase with shares and pre-settles the payer's own share", async () => {
    const repo = createMockRepo();
    const created = await repo.createPurchase({
      household_id: HOUSEHOLD_ID,
      amount: 3000,
      description: "Хлеб",
      shares: [
        { debtor_id: ME_ID, amount: 1500 },
        { debtor_id: "00000000-0000-4000-8000-000000000002", amount: 1500 },
      ],
    });
    expect(created).toMatchObject({ payer_id: ME_ID, source: "manual", status: "shared", merchant: null });
    expect(created.shares[0].settled_at).not.toBeNull();
    expect(created.shares[1].settled_at).toBeNull();
    const list = await repo.listPurchases(HOUSEHOLD_ID);
    expect(list.some((p) => p.id === created.id)).toBe(true);
  });

  it("rejects invalid amounts and non-member households", async () => {
    const repo = createMockRepo();
    await expect(
      repo.createPurchase({ household_id: HOUSEHOLD_ID, amount: 0, description: "x", shares: [] }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.listPurchases("nope")).rejects.toMatchObject({ code: "forbidden" });
    await expect(repo.listMembers("nope")).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("mockRepo validation and isolation", () => {
  const other = "00000000-0000-4000-8000-000000000002";
  const base = { household_id: HOUSEHOLD_ID, amount: 1000, description: "Хлеб" };

  it("requires shares to sum to the amount", async () => {
    const repo = createMockRepo();
    await expect(
      repo.createPurchase({ ...base, shares: [{ debtor_id: ME_ID, amount: 400 }, { debtor_id: other, amount: 400 }] }),
    ).rejects.toMatchObject({ code: "invalid", message: /sum/ });
  });

  it("rejects empty descriptions, fractional or negative amounts, duplicate and foreign debtors", async () => {
    const repo = createMockRepo();
    const ok = [{ debtor_id: ME_ID, amount: 1000 }];
    await expect(repo.createPurchase({ ...base, description: "   ", shares: ok })).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.createPurchase({ ...base, amount: 10.5, shares: ok })).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.createPurchase({ ...base, amount: -5, shares: ok })).rejects.toMatchObject({ code: "invalid" });
    await expect(
      repo.createPurchase({ ...base, shares: [{ debtor_id: other, amount: 500 }, { debtor_id: other, amount: 500 }] }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      repo.createPurchase({ ...base, shares: [{ debtor_id: "stranger", amount: 1000 }] }),
    ).rejects.toMatchObject({ code: "invalid", message: /member/ });
  });

  it("refuses to record a purchase for another payer (mirrors RLS)", async () => {
    const repo = createMockRepo();
    await expect(
      repo.createPurchase({ ...base, payer_id: other, shares: [{ debtor_id: ME_ID, amount: 1000 }] }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("returns copies, never internal references", async () => {
    const repo = createMockRepo();
    const [h] = await repo.listHouseholds();
    h.name = "mutated";
    expect((await repo.listHouseholds())[0].name).toBe("Квартира 42");
    const list = await repo.listPurchases(HOUSEHOLD_ID);
    list[0].description = "mutated";
    list[0].shares.length = 0;
    const again = await repo.listPurchases(HOUSEHOLD_ID);
    expect(again[0].description).not.toBe("mutated");
    expect(again[0].shares.length).toBeGreaterThan(0);
    const me = await repo.getMe();
    me.display_name = "x";
    expect((await repo.getMe()).display_name).toBe("Ерасыл");
  });
});

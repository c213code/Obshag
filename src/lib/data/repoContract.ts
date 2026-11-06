import { describe, expect, it } from "vitest";
import { RepoError, type Repo } from "./repo";

/**
 * Behaviour every Repo implementation must satisfy. Run against mockRepo in unit tests; the
 * Supabase implementation honours the same codes (see supabaseRepo.test.ts for its mapping).
 * `makeRepos` returns two repos sharing ONE backend but with separate sessions (two devices).
 */
export function repoContract(name: string, makeRepos: () => Promise<[Repo, Repo]>) {
  describe(`Repo contract: ${name}`, () => {
    const PASSWORD = "password123";
    const signIn = async (repo: Repo, email: string, display_name: string, kaspi_phone: string) => {
      await repo.signUp(email, PASSWORD);
      await repo.upsertProfile({ display_name, kaspi_phone });
    };

    it("signs up with a password, signs out, signs back in, and signs out", async () => {
      const [a] = await makeRepos();
      expect(await a.getSession()).toBeNull();
      const s = await a.signUp(" A@X.kz ", PASSWORD);
      expect(s.email).toBe("a@x.kz");
      expect(await a.getSession()).toEqual(s);
      expect(await a.getMe()).toBeNull();
      await a.signOut();
      expect(await a.getSession()).toBeNull();
      await expect(a.getMe()).rejects.toMatchObject({ code: "unauthenticated" });
      expect(await a.signIn("a@x.kz", PASSWORD)).toEqual(s);
      expect(await a.getSession()).toEqual(s);
    });

    it("refuses a bad password or an unknown email alike, a taken email, a weak password and a bad email", async () => {
      const [a, b] = await makeRepos();
      await a.signUp("a@x.kz", PASSWORD);
      await a.signOut();
      await expect(b.signIn("a@x.kz", "wrong-password")).rejects.toMatchObject({ code: "invalid_credentials" });
      await expect(b.signIn("nobody@x.kz", PASSWORD)).rejects.toMatchObject({ code: "invalid_credentials" });
      await expect(b.signIn("not-an-email", PASSWORD)).rejects.toMatchObject({ code: "invalid_credentials" });
      await expect(b.signIn("a@x.kz", "")).rejects.toMatchObject({ code: "invalid_credentials" });
      expect(await b.getSession()).toBeNull();
      await expect(b.signUp("a@x.kz", PASSWORD)).rejects.toMatchObject({ code: "email_taken" });
      await expect(b.signUp("A@X.KZ", "another-password")).rejects.toMatchObject({ code: "email_taken" });
      await expect(b.signUp("b@x.kz", "short")).rejects.toMatchObject({ code: "weak_password" });
      await expect(b.signUp("b@x.kz", "1234567")).rejects.toMatchObject({ code: "weak_password" });
      await expect(b.signUp("nope", PASSWORD)).rejects.toMatchObject({ code: "invalid" });
      expect(await b.getSession()).toBeNull();
      expect((await b.signUp("b@x.kz", "12345678")).email).toBe("b@x.kz");
    });

    it("full path: profile, household, join, equal purchase, balances from shares", async () => {
      const [a, b] = await makeRepos();
      await signIn(a, "a@x.kz", "Ерасыл", "+77001234567");
      await signIn(b, "b@x.kz", "Айдос", "+77007654321");
      const me = (await a.getMe())!;
      const other = (await b.getMe())!;
      expect(me.avatar_color).toMatch(/^(blue|brown|purple)$/);

      const h = await a.createHousehold("Квартира 42");
      expect(h.invite_code.length).toBeGreaterThanOrEqual(10);
      expect((await a.listMembers(h.id)).map((m) => [m.profile.display_name, m.role])).toEqual([["Ерасыл", "admin"]]);

      const joined = await b.joinHousehold(h.invite_code.toLowerCase());
      expect(joined.id).toBe(h.id);
      await b.joinHousehold(h.invite_code); // idempotent
      expect(await a.listMembers(h.id)).toHaveLength(2);

      const p = await a.createPurchase({
        household_id: h.id,
        amount: 6001,
        description: "Хлеб, картошка",
        participant_ids: [me.id, other.id],
      });
      expect(p).toMatchObject({ payer_id: me.id, status: "shared", source: "manual", amount: 6001 });
      expect(p.shares.map((s) => [s.debtor_id, s.amount, s.settled_at !== null])).toEqual([
        [me.id, 3000, true],
        [other.id, 3001, false],
      ]);
      const seenByB = await b.listPurchases(h.id);
      expect(seenByB[0].id).toBe(p.id);
    });

    it("hides which codes exist and rate-limits joins (10 per hour)", async () => {
      const [a, b] = await makeRepos();
      await signIn(a, "a@x.kz", "А", "+77001234567");
      await signIn(b, "b@x.kz", "Б", "+77007654321");
      const h = await a.createHousehold("Дача");
      for (let i = 0; i < 10; i++) {
        await expect(b.joinHousehold(`NOPE00000000${i}`)).rejects.toMatchObject({ code: "join_failed" });
      }
      // 11th attempt: even the correct code looks exactly like any other failure
      const err = await b.joinHousehold(h.invite_code).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RepoError);
      expect(err).toMatchObject({ code: "join_failed", message: "Invalid or unavailable invite code" });
    });

    it("keeps non-members out and validates purchases", async () => {
      const [a, b] = await makeRepos();
      await signIn(a, "a@x.kz", "А", "+77001234567");
      await signIn(b, "b@x.kz", "Б", "+77007654321");
      const h = await a.createHousehold("Дача");
      const meB = (await b.getMe())!;
      const meA = (await a.getMe())!;
      await expect(b.listPurchases(h.id)).rejects.toMatchObject({ code: "forbidden" });
      await expect(b.listMembers(h.id)).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        b.createPurchase({ household_id: h.id, amount: 100, description: "x", participant_ids: [meB.id] }),
      ).rejects.toMatchObject({ code: "forbidden" });
      // participant who is not a member
      await expect(
        a.createPurchase({ household_id: h.id, amount: 100, description: "x", participant_ids: [meA.id, meB.id] }),
      ).rejects.toMatchObject({ code: "invalid" });
      await expect(
        a.createPurchase({ household_id: h.id, amount: 0, description: "x", participant_ids: [meA.id] }),
      ).rejects.toMatchObject({ code: "invalid" });
      // fewer tenge than people: nobody may owe 0
      await expect(
        a.createPurchase({ household_id: h.id, amount: 1, description: "x", participant_ids: [meA.id, meB.id] }),
      ).rejects.toMatchObject({ code: "invalid" });
      expect(await b.listHouseholds()).toEqual([]);
    });

    it("an over-long code is a plain miss", async () => {
      const [a, b] = await makeRepos();
      await signIn(a, "a@x.kz", "А", "+77001234567");
      await signIn(b, "b@x.kz", "Б", "+77007654321");
      await a.createHousehold("Дача");
      await expect(b.joinHousehold("A".repeat(65))).rejects.toMatchObject({ code: "join_failed" });
    });

    it("needs a profile before creating or joining a household", async () => {
      const [a] = await makeRepos();
      await a.signUp("a@x.kz", PASSWORD);
      await expect(a.createHousehold("Дача")).rejects.toMatchObject({ code: "profile_required" });
      await expect(a.joinHousehold("ABCDEFGHJK")).rejects.toMatchObject({ code: "profile_required" });
    });

    describe("settlements", () => {
      const tick = () => new Promise((r) => setTimeout(r, 5));
      /** A owes B 2000 (Интернет), B owes A 1800 (Картошка): A pays 200. */
      async function setup() {
        const [a, b] = await makeRepos();
        await signIn(a, "a@x.kz", "Ерасыл", "+77001234567");
        await signIn(b, "b@x.kz", "Айдос", "+77007654321");
        const meA = (await a.getMe())!;
        const meB = (await b.getMe())!;
        const h = await a.createHousehold("Квартира");
        await b.joinHousehold(h.invite_code);
        await b.createPurchase({ household_id: h.id, amount: 4000, description: "Интернет", participant_ids: [meA.id, meB.id] });
        await a.createPurchase({ household_id: h.id, amount: 3600, description: "Картошка", participant_ids: [meA.id, meB.id] });
        return { a, b, meA, meB, h };
      }

      it("marks for the server-side net, idempotently, and shows it to both people", async () => {
        const { a, b, meB, h } = await setup();
        const s = await a.markSettlement(h.id, meB.id);
        expect(s).toMatchObject({ status: "marked", amount: 200, from_id: (await a.getMe())!.id, to_id: meB.id, confirmed_at: null });
        expect((await a.markSettlement(h.id, meB.id)).id).toBe(s.id);
        expect((await a.listSettlements(h.id)).map((x) => x.id)).toEqual([s.id]);
        expect((await b.listSettlements(h.id)).map((x) => x.id)).toEqual([s.id]);
      });

      it("refuses to mark when you do not owe, with yourself, or as an outsider", async () => {
        const { a, b, meA, meB, h } = await setup();
        await expect(b.markSettlement(h.id, meA.id)).rejects.toMatchObject({ code: "invalid" }); // B is the creditor
        await expect(a.markSettlement(h.id, meA.id)).rejects.toMatchObject({ code: "invalid" });
        await b.signOut(); // the second device becomes an outsider of the same backend
        const outsider = b;
        await signIn(outsider, "o@x.kz", "Чужой", "+77000000000");
        await expect(outsider.markSettlement(h.id, meB.id)).rejects.toMatchObject({ code: "forbidden" });
        await expect(outsider.listSettlements(h.id)).rejects.toMatchObject({ code: "forbidden" });
        await expect(a.markSettlement(h.id, "00000000-0000-4000-8000-0000000000ff")).rejects.toMatchObject({ code: "invalid" });
      });

      it("only the creditor confirms; the pair is at 0 afterwards and a second confirm is a no-op", async () => {
        const { a, b, meA, meB, h } = await setup();
        const s = await a.markSettlement(h.id, meB.id);
        await expect(a.confirmSettlement(s.id)).rejects.toMatchObject({ code: "forbidden" });
        await expect(b.confirmSettlement("00000000-0000-4000-8000-0000000000ff")).rejects.toMatchObject({ code: "not_found" });
        const done = await b.confirmSettlement(s.id);
        expect(done).toMatchObject({ id: s.id, status: "confirmed" });
        expect(done.confirmed_at).not.toBeNull();
        const after = await b.listPurchases(h.id);
        const open = after.flatMap((p) => p.shares.filter((x) => x.settled_at === null));
        expect(open).toEqual([]);
        // a purchase made after the confirmation is not swallowed by confirming again
        await tick();
        await b.createPurchase({ household_id: h.id, amount: 1000, description: "Вода", participant_ids: [meA.id, meB.id] });
        expect(await b.confirmSettlement(s.id)).toEqual(done);
        const openNow = (await a.listPurchases(h.id)).flatMap((p) => p.shares.filter((x) => x.settled_at === null));
        expect(openNow).toHaveLength(1);
      });

      it("a purchase created after the mark stays open after the confirm", async () => {
        const { a, b, meA, meB, h } = await setup();
        await tick();
        const s = await a.markSettlement(h.id, meB.id);
        await tick();
        await b.createPurchase({ household_id: h.id, amount: 600, description: "После", participant_ids: [meA.id, meB.id] });
        await b.confirmSettlement(s.id);
        const open = (await a.listPurchases(h.id)).flatMap((p) => p.shares.filter((x) => x.settled_at === null));
        expect(open.map((x) => [x.debtor_id, x.amount])).toEqual([[meA.id, 300]]);
      });

      it("marking records the exact set: a purchase added later stays open, re-marking refreshes set and amount", async () => {
        const { a, b, meA, meB, h } = await setup();
        const s = await a.markSettlement(h.id, meB.id);
        expect(s.covered.map((c) => c.amount).sort((x, y) => y - x)).toEqual([2000, 1800]);
        await b.createPurchase({ household_id: h.id, amount: 600, description: "После", participant_ids: [meA.id, meB.id] });
        // the open mark shows what it recorded until it is asked again
        expect((await a.listSettlements(h.id))[0].covered).toHaveLength(2);
        const again = await a.markSettlement(h.id, meB.id);
        expect(again.id).toBe(s.id);
        expect(again).toMatchObject({ amount: 500 });
        expect(again.covered).toHaveLength(3);
        await b.confirmSettlement(s.id);
        const open = (await a.listPurchases(h.id)).flatMap((p) => p.shares.filter((x) => x.settled_at === null));
        expect(open).toEqual([]);
      });

      it("confirming with a different expected amount is stale and closes nothing", async () => {
        const { a, b, meB, h } = await setup();
        const s = await a.markSettlement(h.id, meB.id);
        await expect(b.confirmSettlement(s.id, s.amount + 1)).rejects.toMatchObject({ code: "stale" });
        expect((await b.confirmSettlement(s.id, s.amount)).status).toBe("confirmed");
      });

      it("limits mark/cancel to 20 calls per user per hour", async () => {
        const { a, meB, h } = await setup();
        for (let i = 0; i < 20; i++) await a.markSettlement(h.id, meB.id);
        await expect(a.markSettlement(h.id, meB.id)).rejects.toMatchObject({ code: "rate_limited" });
      });

      it("the debtor or the creditor can cancel; a confirmed one cannot be cancelled; strangers cannot", async () => {
        const { a, b, meB, h } = await setup();
        const s = await a.markSettlement(h.id, meB.id);
        expect((await b.cancelSettlement(s.id)).status).toBe("cancelled");
        expect((await a.cancelSettlement(s.id)).status).toBe("cancelled"); // twice: no-op
        await expect(b.confirmSettlement(s.id)).rejects.toMatchObject({ code: "invalid" });
        const again = await a.markSettlement(h.id, meB.id);
        expect(again.id).not.toBe(s.id);
        await b.signOut();
        await signIn(b, "o@x.kz", "Чужой", "+77000000000");
        // somebody else's settlement looks exactly like a missing one
        await expect(b.cancelSettlement(again.id)).rejects.toMatchObject({ code: "not_found" });
        await expect(b.confirmSettlement(again.id)).rejects.toMatchObject({ code: "not_found" });
        await b.signOut();
        await b.signIn("b@x.kz", PASSWORD);
        await b.confirmSettlement(again.id);
        await expect(a.cancelSettlement(again.id)).rejects.toMatchObject({ code: "invalid" });
        await expect(a.cancelSettlement("00000000-0000-4000-8000-0000000000ff")).rejects.toMatchObject({ code: "not_found" });
      });
    });
  });
}

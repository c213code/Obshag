import { describe, expect, it } from "vitest";
import { RepoError, type Repo } from "./repo";

/**
 * Behaviour every Repo implementation must satisfy. Run against mockRepo in unit tests; the
 * Supabase implementation honours the same codes (see supabaseRepo.test.ts for its mapping).
 * `makeRepos` returns two repos sharing ONE backend but with separate sessions (two devices).
 */
export function repoContract(name: string, makeRepos: () => Promise<[Repo, Repo]>) {
  describe(`Repo contract: ${name}`, () => {
    const signIn = async (repo: Repo, email: string, display_name: string, kaspi_phone: string) => {
      await repo.requestOtp(email);
      await repo.verifyOtp(email, "000000");
      await repo.upsertProfile({ display_name, kaspi_phone });
    };

    it("signs in with a code, rejects a wrong code, and signs out", async () => {
      const [a] = await makeRepos();
      expect(await a.getSession()).toBeNull();
      await expect(a.verifyOtp("a@x.kz", "123456")).rejects.toMatchObject({ code: "otp_failed" });
      const s = await a.verifyOtp("a@x.kz", "000000");
      expect(s.email).toBe("a@x.kz");
      expect(await a.getSession()).toEqual(s);
      expect(await a.getMe()).toBeNull();
      await a.signOut();
      expect(await a.getSession()).toBeNull();
      await expect(a.getMe()).rejects.toMatchObject({ code: "unauthenticated" });
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
      await a.verifyOtp("a@x.kz", "000000");
      await expect(a.createHousehold("Дача")).rejects.toMatchObject({ code: "profile_required" });
      await expect(a.joinHousehold("ABCDEFGHJK")).rejects.toMatchObject({ code: "profile_required" });
    });
  });
}

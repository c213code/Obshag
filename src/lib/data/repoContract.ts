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

    it("stores a Telegram username without the @, clears it, and rejects bad ones", async () => {
      const [a] = await makeRepos();
      await signIn(a, "tg@x.kz", "Тг", "+77001234567");
      expect(await a.setTelegramUsername(" @Aidos_k ")).toBe("Aidos_k");
      expect((await a.getMe())?.telegram_username).toBe("Aidos_k");
      await expect(a.setTelegramUsername("ab")).rejects.toMatchObject({ code: "invalid" });
      expect(await a.setTelegramUsername("")).toBeNull();
      expect((await a.getMe())?.telegram_username ?? null).toBeNull();
    });

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

    it("forgot password: neutral for any address; the mock link sets a new password for the seeded user", async () => {
      const [a] = await makeRepos();
      await expect(a.requestPasswordReset("nobody@x.kz", "https://app.test/reset")).resolves.toBeUndefined();
      await expect(a.requestPasswordReset("nope", "https://app.test/reset")).rejects.toMatchObject({ code: "invalid" });
      await expect(a.startPasswordRecovery({ code: "x" })).rejects.toMatchObject({ code: "invalid_link" });
      await a.startPasswordRecovery({ mock: true });
      await expect(a.updatePassword("short")).rejects.toMatchObject({ code: "weak_password" });
      await a.updatePassword("brand-new-pass");
      const who = await a.getSession();
      await a.signOut();
      await expect(a.signIn(who!.email, PASSWORD)).rejects.toMatchObject({ code: "invalid_credentials" });
      expect((await a.signIn(who!.email, "brand-new-pass")).email).toBe(who!.email);
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

    describe("capture and pending", () => {
      async function setup() {
        const [a, b] = await makeRepos();
        await signIn(a, "a@x.kz", "Ерасыл", "+77001234567");
        await signIn(b, "b@x.kz", "Айдос", "+77007654321");
        const meA = (await a.getMe())!;
        const meB = (await b.getMe())!;
        const h = await a.createHousehold("Квартира 42");
        await b.joinHousehold(h.invite_code);
        return { a, b, meA, meB, h };
      }

      it("rotates a token: the old one dies, and the owner only sees that a token exists", async () => {
        const { a, b } = await setup();
        expect(await a.getCaptureTokenInfo()).toBeNull();
        const first = await a.rotateCaptureToken();
        expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(await a.getCaptureTokenInfo()).toMatchObject({ last_used_at: null });
        expect(await b.getCaptureTokenInfo()).toBeNull();
        const second = await a.rotateCaptureToken();
        expect(second).not.toBe(first);
        await expect(b.capture(first, 1000, "Magnum")).rejects.toMatchObject({ code: "unauthenticated" });
        await expect(b.capture(second, 1000, "Magnum")).resolves.toMatchObject({ amount: 1000 });
      });

      it("capture creates a pending purchase visible to the payer only", async () => {
        const { a, b, meA, h } = await setup();
        const token = await a.rotateCaptureToken();
        const r = await b.capture(token, 6000, " Magnum ");
        expect(r).toMatchObject({ household_id: h.id, amount: 6000, merchant: "Magnum", subscriptions: [] });
        expect((await a.getCaptureTokenInfo())?.last_used_at).not.toBeNull();
        const mine = await a.listPending(h.id);
        expect(mine).toHaveLength(1);
        expect(mine[0]).toMatchObject({ id: r.purchase_id, payer_id: meA.id, status: "pending", source: "apple_pay", description: "Magnum", shares: [] });
        expect((await a.listPurchases(h.id)).map((p) => p.id)).toContain(r.purchase_id);
        expect((await b.listPurchases(h.id)).map((p) => p.id)).not.toContain(r.purchase_id);
        expect(await b.listPending(h.id)).toEqual([]);
      });

      it("capture rejects a bad token, a bad amount, a missing household and the 31st call in an hour", async () => {
        const { a, b } = await setup();
        const token = await a.rotateCaptureToken();
        await expect(b.capture("x".repeat(43), 1000)).rejects.toMatchObject({ code: "unauthenticated" });
        await expect(b.capture("short", 1000)).rejects.toMatchObject({ code: "unauthenticated" });
        await expect(b.capture(token, 0)).rejects.toMatchObject({ code: "invalid" });
        await expect(b.capture(token, 10_000_001)).rejects.toMatchObject({ code: "invalid" });
        for (let i = 0; i < 30; i++) await b.capture(token, 100 + i);
        await expect(b.capture(token, 1)).rejects.toMatchObject({ code: "rate_limited" });
      });

      it("capture with no household is invalid", async () => {
        const [a] = await makeRepos();
        await signIn(a, "lonely@x.kz", "Один", "+77001234567");
        const token = await a.rotateCaptureToken();
        await expect(a.capture(token, 1000, "X")).rejects.toMatchObject({ code: "invalid" });
      });

      it("uses the default household when set, and only for a member", async () => {
        const { a, b, h } = await setup();
        const second = await a.createHousehold("Дача");
        const token = await a.rotateCaptureToken();
        await a.setDefaultHousehold(h.id);
        expect((await b.capture(token, 500)).household_id).toBe(h.id);
        await a.setDefaultHousehold(second.id);
        expect((await b.capture(token, 501)).household_id).toBe(second.id);
        await expect(b.setDefaultHousehold(second.id)).rejects.toMatchObject({ code: "forbidden" });
      });

      it("resolves shared with the equal split and the right visibility; asking again is a no-op", async () => {
        const { a, b, meA, meB, h } = await setup();
        const token = await a.rotateCaptureToken();
        const { purchase_id } = await b.capture(token, 1000, "Magnum");
        const done = await a.resolvePending(purchase_id, { shared: true, description: "Продукты", participant_ids: [meA.id, meB.id] });
        expect(done).toMatchObject({ status: "shared", description: "Продукты" });
        expect(done.shares.reduce((sum, x) => sum + x.amount, 0)).toBe(1000);
        expect(done.shares.find((x) => x.debtor_id === meB.id)?.amount).toBe(500);
        expect((await b.listPurchases(h.id)).map((p) => p.id)).toContain(purchase_id);
        expect(await a.listPending(h.id)).toEqual([]);
        const again = await a.resolvePending(purchase_id, { shared: true, description: "Другое", participant_ids: [meA.id] });
        expect(again.description).toBe("Продукты");
        expect(again.shares).toHaveLength(2);
        await expect(a.resolvePending(purchase_id, { shared: false })).rejects.toMatchObject({ code: "invalid" });
      });

      it("resolves personal: hidden from others, the description is kept when none is given", async () => {
        const { a, b, h } = await setup();
        const token = await a.rotateCaptureToken();
        const { purchase_id } = await b.capture(token, 777, "Kofe");
        const done = await a.resolvePending(purchase_id, { shared: false, description: "  " });
        expect(done).toMatchObject({ status: "personal", description: "Kofe", shares: [] });
        expect((await b.listPurchases(h.id)).map((p) => p.id)).not.toContain(purchase_id);
        expect((await a.resolvePending(purchase_id, { shared: false })).status).toBe("personal");
        await expect(a.resolvePending(purchase_id, { shared: true, participant_ids: [] })).rejects.toMatchObject({ code: "invalid" });
      });

      it("only the payer can resolve; strangers get not_found; participants are validated", async () => {
        const { a, b, meA, meB, h } = await setup();
        const token = await a.rotateCaptureToken();
        const { purchase_id } = await b.capture(token, 1000);
        await expect(b.resolvePending(purchase_id, { shared: true, participant_ids: [meA.id, meB.id] })).rejects.toMatchObject({ code: "not_found" });
        await expect(a.resolvePending("00000000-0000-4000-8000-0000000000ff", { shared: false })).rejects.toMatchObject({ code: "not_found" });
        await expect(a.resolvePending(purchase_id, { shared: true, participant_ids: [] })).rejects.toMatchObject({ code: "invalid" });
        await expect(a.resolvePending(purchase_id, { shared: true, participant_ids: [meA.id, meA.id] })).rejects.toMatchObject({ code: "invalid" });
        await expect(a.resolvePending(purchase_id, { shared: true, participant_ids: [meA.id, "00000000-0000-4000-8000-0000000000ee"] })).rejects.toMatchObject({ code: "invalid" });
        expect(await a.listPending(h.id)).toHaveLength(1);
      });

      it("dedupes a retry and strips control characters from the merchant", async () => {
        const { a, b } = await setup();
        const token = await a.rotateCaptureToken();
        const first = await b.capture(token, 4200, "Mag\u202enum\u0007");
        expect(first.merchant).toBe("Magnum");
        expect((await b.capture(token, 4200, "Magnum")).purchase_id).toBe(first.purchase_id);
        expect((await b.capture(token, 4201, "Magnum")).purchase_id).not.toBe(first.purchase_id);
      });

      it("stores push subscriptions by endpoint, returns them to the capture, and prunes with the token", async () => {
        const { a, b } = await setup();
        const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/e1", p256dh: "k", auth: "a" };
        await a.savePushSubscription(sub);
        await a.savePushSubscription({ ...sub, p256dh: "k2" }); // upsert
        await expect(a.savePushSubscription({ ...sub, endpoint: "http://insecure/x" })).rejects.toMatchObject({ code: "invalid" });
        const token = await a.rotateCaptureToken();
        expect((await b.capture(token, 100)).subscriptions).toEqual([{ ...sub, p256dh: "k2" }]);
        await expect(b.prunePushSubscription("y".repeat(43), sub.endpoint)).rejects.toMatchObject({ code: "unauthenticated" });
        await b.prunePushSubscription(token, sub.endpoint);
        expect((await b.capture(token, 102)).subscriptions).toEqual([]);
        await a.savePushSubscription(sub);
        await a.deletePushSubscription(sub.endpoint);
        expect((await b.capture(token, 103)).subscriptions).toEqual([]);
      });
    });
  });
}

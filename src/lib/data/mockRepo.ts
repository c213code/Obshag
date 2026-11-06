import { RepoError, type MemberWithProfile, type NewPurchase, type PurchaseWithShares, type Repo } from "./repo";
import { createSeed, type Seed } from "./seed";
import { householdNameSchema, newPurchaseSchema } from "./schemas";
import type { Household, Purchase, Share, Uuid } from "./types";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

const firstIssue = (e: { issues: ReadonlyArray<{ message: string }> }) => e.issues[0]?.message ?? "Invalid input";

/**
 * In-memory Repo for mock mode and tests. Each call to createMockRepo is an isolated store.
 * Every method returns copies, so callers can never mutate internal state.
 * In the app the instance is created once per browser session by RepoProvider (client only).
 */
export function createMockRepo(seed: Seed = createSeed()): Repo {
  const state = {
    households: [...seed.households],
    members: [...seed.members],
    purchases: [...seed.purchases],
    shares: [...seed.shares],
  };
  const me = seed.me;
  const profile = (id: Uuid) => seed.profiles.find((p) => p.id === id);
  const isMember = (householdId: Uuid) =>
    state.members.some((m) => m.household_id === householdId && m.user_id === me.id);
  const withShares = (p: Purchase): PurchaseWithShares =>
    structuredClone({ ...p, shares: state.shares.filter((s) => s.purchase_id === p.id) });
  const requireMember = (householdId: Uuid) => {
    if (!isMember(householdId)) throw new RepoError("forbidden", "Not a member of this household");
  };

  return {
    async getMe() {
      return structuredClone(me);
    },

    async listHouseholds() {
      return structuredClone(state.households.filter((h) => isMember(h.id)));
    },

    async listMembers(householdId) {
      requireMember(householdId);
      return state.members
        .filter((m) => m.household_id === householdId)
        .flatMap((m): MemberWithProfile[] => {
          const p = profile(m.user_id);
          return p ? [structuredClone({ ...m, profile: p })] : [];
        });
    },

    async listPurchases(householdId) {
      requireMember(householdId);
      return state.purchases
        .filter((p) => p.household_id === householdId)
        .filter((p) => p.status !== "personal" || p.payer_id === me.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(withShares);
    },

    async createHousehold(name) {
      const parsed = householdNameSchema.safeParse(name);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      const trimmed = parsed.data;
      const now = new Date().toISOString();
      const household: Household = {
        id: crypto.randomUUID(),
        name: trimmed,
        invite_code: randomCode(),
        created_by: me.id,
        created_at: now,
      };
      state.households.push(household);
      state.members.push({ household_id: household.id, user_id: me.id, role: "admin", away_until: null, joined_at: now });
      return structuredClone(household);
    },

    async joinHousehold(inviteCode) {
      const code = inviteCode.trim().toUpperCase();
      const household = state.households.find((h) => h.invite_code === code);
      if (!household) throw new RepoError("not_found", "Invite code not found");
      if (!isMember(household.id)) {
        state.members.push({
          household_id: household.id,
          user_id: me.id,
          role: "member",
          away_until: null,
          joined_at: new Date().toISOString(),
        });
      }
      return structuredClone(household);
    },

    async createPurchase(raw: NewPurchase) {
      requireMember(raw.household_id);
      const parsed = newPurchaseSchema.safeParse(raw);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      const input = parsed.data;
      // Mirrors RLS: clients may only record purchases they paid themselves.
      if (input.payer_id !== undefined && input.payer_id !== me.id) {
        throw new RepoError("forbidden", "Purchases can only be recorded for yourself");
      }
      const householdMembers = new Set(
        state.members.filter((m) => m.household_id === input.household_id).map((m) => m.user_id),
      );
      if (input.shares.some((s) => !householdMembers.has(s.debtor_id))) {
        throw new RepoError("invalid", "Every debtor must be a member of the household");
      }
      const purchase: Purchase = {
        id: crypto.randomUUID(),
        household_id: input.household_id,
        payer_id: me.id,
        amount: input.amount,
        description: input.description,
        merchant: input.merchant ?? null,
        source: input.source ?? "manual",
        status: input.status ?? "shared",
        created_at: new Date().toISOString(),
      };
      const shares: Share[] = input.shares.map((s) => ({
        purchase_id: purchase.id,
        debtor_id: s.debtor_id,
        amount: s.amount,
        settled_at: s.debtor_id === purchase.payer_id ? purchase.created_at : null,
        settlement_id: null,
      }));
      state.purchases.push(purchase);
      state.shares.push(...shares);
      return structuredClone({ ...purchase, shares });
    },
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createPurchaseSchema,
  emailSchema,
  householdNameSchema,
  inviteCodeSchema,
  otpSchema,
  profileSchema,
} from "@/lib/domain/schemas";
import {
  RepoError,
  type AuthSession,
  type MemberWithProfile,
  type NewPurchase,
  type ProfileDraft,
  type PurchaseWithShares,
  type Repo,
  type RepoErrorCode,
} from "./repo";
import type { Household, Member, Profile, Share } from "./types";

type DbError = { code?: string; message?: string } | null;

const JOIN_FAILED = "Invalid or unavailable invite code";

/** Fixed, safe messages: raw database text can name tables, constraints or values, so it never reaches callers. */
const MESSAGES: Record<RepoErrorCode, string> = {
  unauthenticated: "Not signed in",
  profile_required: "Create a profile first",
  not_found: "Not found",
  invalid: "Invalid input",
  forbidden: "Not allowed",
  join_failed: JOIN_FAILED,
  otp_failed: "Invalid code",
  unknown: "Request failed",
};

/** Raw errors go to the console in development only. */
function debugLog(scope: string, error: unknown) {
  if (process.env.NODE_ENV !== "production") console.debug(`[supabaseRepo] ${scope}`, error);
}

/** Maps Postgres/PostgREST errors to the same codes mockRepo throws (with fixed messages). */
export function mapDbError(error: NonNullable<DbError>): RepoError {
  debugLog("db error", error);
  const message = error.message ?? "";
  let code: RepoErrorCode = "unknown";
  if (error.code === "28000") code = "unauthenticated";
  else if (error.code === "42501") code = "forbidden";
  else if (["23514", "23503", "23505", "22023", "22P02"].includes(error.code ?? "")) code = "invalid";
  else if (message.includes("join_failed")) code = "join_failed";
  else if (message.includes("profile_required")) code = "profile_required";
  return new RepoError(code, MESSAGES[code]);
}

function ok<T>(result: { data: unknown; error: DbError }): T {
  if (result.error) throw mapDbError(result.error);
  if (result.data === null || result.data === undefined) throw new RepoError("not_found", "Not found");
  return result.data as T;
}

const firstIssue = (e: { issues: ReadonlyArray<{ message: string }> }) => e.issues[0]?.message ?? "Invalid input";

type MemberRow = Member & { profile: Profile | null };
type PurchaseRow = Omit<PurchaseWithShares, "shares"> & { shares: Array<Share & { household_id?: string }> };

const toShare = ({ purchase_id, debtor_id, amount, settled_at, settlement_id }: Share): Share => ({
  purchase_id,
  debtor_id,
  amount,
  settled_at,
  settlement_id,
});
const toPurchase = ({ shares, ...p }: PurchaseRow): PurchaseWithShares => ({ ...p, shares: shares.map(toShare) });

/**
 * Supabase implementation: reads are RLS-filtered selects, every write is a security-definer RPC
 * (the client has no insert/update on members, shares or settlements). Not run live in slice 1.
 */
export function createSupabaseRepo(client: SupabaseClient): Repo {
  async function currentUser(): Promise<AuthSession | null> {
    const { data } = await client.auth.getSession();
    const user = data.session?.user;
    return user ? { user_id: user.id, email: user.email ?? "" } : null;
  }

  return {
    getSession: currentUser,

    async requestOtp(email) {
      const parsed = emailSchema.safeParse(email);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      const { error } = await client.auth.signInWithOtp({ email: parsed.data, options: { shouldCreateUser: true } });
      if (error) {
        debugLog("requestOtp", error);
        throw new RepoError("unknown", MESSAGES.unknown);
      }
    },

    async verifyOtp(email, code) {
      const e = emailSchema.safeParse(email);
      const c = otpSchema.safeParse(code);
      if (!e.success || !c.success) throw new RepoError("otp_failed", "Invalid code");
      const { data, error } = await client.auth.verifyOtp({ email: e.data, token: c.data, type: "email" });
      if (error || !data.user) {
        if (error) debugLog("verifyOtp", error);
        throw new RepoError("otp_failed", MESSAGES.otp_failed);
      }
      return { user_id: data.user.id, email: data.user.email ?? e.data };
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) {
        debugLog("signOut", error);
        throw new RepoError("unknown", MESSAGES.unknown);
      }
    },

    async getMe() {
      const user = await currentUser();
      if (!user) throw new RepoError("unauthenticated", "Not signed in");
      const { data, error } = await client.from("profiles").select("*").eq("id", user.user_id).maybeSingle();
      if (error) throw mapDbError(error);
      return (data as Profile | null) ?? null;
    },

    async upsertProfile(input: ProfileDraft) {
      const parsed = profileSchema.safeParse(input);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      const res = await client.rpc("upsert_profile", { p_name: parsed.data.display_name, p_phone: parsed.data.kaspi_phone });
      return ok<Profile>(res);
    },

    async listHouseholds() {
      const res = await client.from("households").select("*").order("created_at", { ascending: true }).order("id", { ascending: true });
      return ok<Household[]>(res);
    },

    async listMembers(householdId) {
      const res = await client
        .from("members")
        .select("*, profile:profiles(*)")
        .eq("household_id", householdId)
        .eq("active", true)
        .order("joined_at", { ascending: true })
        .order("user_id", { ascending: true });
      return ok<MemberRow[]>(res).flatMap((m): MemberWithProfile[] => (m.profile ? [{ ...m, profile: m.profile }] : []));
    },

    async listPurchases(householdId) {
      const res = await client
        .from("purchases")
        .select("*, shares(*)")
        .eq("household_id", householdId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      return ok<PurchaseRow[]>(res).map(toPurchase);
    },

    async createHousehold(name) {
      const parsed = householdNameSchema.safeParse(name);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      const res = await client.rpc("create_household", { household_name: parsed.data });
      // the profile row is the FK target of households.created_by
      if (res.error?.code === "23503") throw new RepoError("profile_required", "Create a profile first");
      return ok<Household>(res);
    },

    async joinHousehold(inviteCode) {
      const parsed = inviteCodeSchema.safeParse(inviteCode);
      // A malformed code is indistinguishable from a wrong one, but still counts as an attempt server-side.
      const code = parsed.success ? parsed.data : inviteCode.trim().slice(0, 64);
      const { data, error } = await client.rpc("join_household", { code });
      if (error) {
        const mapped = mapDbError(error);
        throw mapped.code === "profile_required" || mapped.code === "unauthenticated"
          ? mapped
          : new RepoError("join_failed", JOIN_FAILED);
      }
      const household = data as Household | null;
      if (!household || !household.id) throw new RepoError("join_failed", JOIN_FAILED);
      return household;
    },

    async createPurchase(raw: NewPurchase) {
      const parsed = createPurchaseSchema.safeParse(raw);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      const input = parsed.data;
      // One round trip: the RPC returns the saved purchase with its shares. Only an RPC failure is a failure;
      // there is deliberately no follow-up read that could fail after the purchase was already saved.
      const row = ok<PurchaseRow>(
        await client.rpc("create_purchase_with_shares", {
          p_household_id: input.household_id,
          p_amount: input.amount,
          p_description: input.description,
          p_merchant: input.merchant ? input.merchant : null,
          p_participant_ids: input.participant_ids,
        }),
      );
      if (!Array.isArray(row.shares)) throw new RepoError("unknown", MESSAGES.unknown);
      return toPurchase(row);
    },
  };
}

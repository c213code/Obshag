import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createPurchaseSchema,
  emailSchema,
  householdNameSchema,
  inviteCodeSchema,
  passwordSchema,
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
import type { Household, Member, Profile, Settlement, SettlementShare, Share } from "./types";

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
  invalid_credentials: "Invalid email or password",
  email_taken: "Email is already registered",
  weak_password: "Password is too weak",
  rate_limited: "Too many requests",
  stale: "The amounts changed since the payment was marked",
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
  else if (error.code === "23514" && message.includes("stale_settlement")) code = "stale";
  else if (["23514", "23503", "23505", "22023", "22P02"].includes(error.code ?? "")) code = "invalid";
  else if (error.code === "P0002") code = "not_found";
  else if (message.includes("rate_limited")) code = "rate_limited";
  else if (message.includes("join_failed")) code = "join_failed";
  else if (message.includes("profile_required")) code = "profile_required";
  return new RepoError(code, MESSAGES[code]);
}

type AuthError = { code?: string; status?: number; message?: string };

/** Maps a Supabase Auth error to a repo error (fixed messages only). */
export function mapAuthError(error: AuthError): RepoError {
  debugLog("auth error", error);
  switch (error.code) {
    case "invalid_credentials":
      return new RepoError("invalid_credentials", MESSAGES.invalid_credentials);
    case "user_already_exists":
    case "email_exists":
      return new RepoError("email_taken", MESSAGES.email_taken);
    case "weak_password":
      return new RepoError("weak_password", MESSAGES.weak_password);
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return new RepoError("rate_limited", MESSAGES.rate_limited);
    default:
      return error.status === 429 ? new RepoError("rate_limited", MESSAGES.rate_limited) : new RepoError("unknown", MESSAGES.unknown);
  }
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

const withCovered = (row: Omit<Settlement, "covered"> & { covered: SettlementShare[] | null }): Settlement => ({
  ...row,
  covered: (row.covered ?? []).map(({ purchase_id, debtor_id, amount }) => ({ purchase_id, debtor_id, amount })),
});

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

  /**
   * The recorded set of a settlement the RPC just returned. The RPC already succeeded, so a failing read must not turn
   * that into an error: an empty list is returned and the next refresh fills it in.
   */
  async function recordedShares(settlementId: string): Promise<SettlementShare[]> {
    const res = await client.from("settlement_shares").select("purchase_id, debtor_id, amount").eq("settlement_id", settlementId);
    return res.error || !Array.isArray(res.data) ? [] : (res.data as SettlementShare[]);
  }

  return {
    getSession: currentUser,

    async signUp(email, password) {
      const e = emailSchema.safeParse(email);
      if (!e.success) throw new RepoError("invalid", firstIssue(e.error));
      if (!passwordSchema.safeParse(password).success) throw new RepoError("weak_password", MESSAGES.weak_password);
      const { data, error } = await client.auth.signUp({ email: e.data, password });
      if (error) throw mapAuthError(error);
      // "Confirm email" ON would hide an existing account behind a user without identities and give no session
      if (data.user && data.user.identities?.length === 0) throw new RepoError("email_taken", MESSAGES.email_taken);
      if (!data.user || !data.session) {
        debugLog("signUp", "no session: is 'Confirm email' still ON in the Supabase Auth settings?");
        throw new RepoError("unknown", MESSAGES.unknown);
      }
      return { user_id: data.user.id, email: data.user.email ?? e.data };
    },

    async signIn(email, password) {
      const e = emailSchema.safeParse(email);
      if (!e.success || !password) throw new RepoError("invalid_credentials", MESSAGES.invalid_credentials);
      const { data, error } = await client.auth.signInWithPassword({ email: e.data, password });
      if (error || !data.user) throw error ? mapAuthError(error) : new RepoError("invalid_credentials", MESSAGES.invalid_credentials);
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

    async listSettlements(householdId) {
      const res = await client
        .from("settlements")
        .select("*, covered:settlement_shares(purchase_id, debtor_id, amount)")
        .eq("household_id", householdId)
        .order("marked_at", { ascending: false })
        .order("id", { ascending: true });
      return ok<Array<Omit<Settlement, "covered"> & { covered: SettlementShare[] | null }>>(res).map(withCovered);
    },

    async markSettlement(householdId, toUserId) {
      // the amount is never sent: the RPC records the open shares and derives the amount from them
      const row = ok<Omit<Settlement, "covered">>(await client.rpc("mark_settlement", { p_household_id: householdId, p_to: toUserId }));
      return withCovered({ ...row, covered: await recordedShares(row.id) });
    },

    async confirmSettlement(settlementId, expectedAmount) {
      const row = ok<Omit<Settlement, "covered">>(
        await client.rpc("confirm_settlement", {
          p_settlement_id: settlementId,
          ...(expectedAmount === undefined ? {} : { p_expected_amount: expectedAmount }),
        }),
      );
      return withCovered({ ...row, covered: await recordedShares(row.id) });
    },

    async cancelSettlement(settlementId) {
      const row = ok<Omit<Settlement, "covered">>(await client.rpc("cancel_settlement", { p_settlement_id: settlementId }));
      return withCovered({ ...row, covered: null });
    },
  };
}

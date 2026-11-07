import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createPurchaseCustomSchema,
  createPurchaseSchema,
  descriptionSchema,
  emailSchema,
  pushSubscriptionSchema,
  resolvePendingSchema,
  householdNameSchema,
  inviteCodeSchema,
  passwordSchema,
  profileSchema,
  billSchema,
  billMonthSchema,
  tengeSchema,
} from "@/lib/domain/schemas";
import {
  RepoError,
  type AuthSession,
  type MemberWithProfile,
  type NewCustomPurchase,
  type NewPurchase,
  type ProfileDraft,
  type PurchaseWithShares,
  type Repo,
  type RepoErrorCode,
} from "./repo";
import type { Bill, CaptureResult, MonthlyRun, CaptureTokenInfo, Household, Member, Profile, ReminderTarget, Settlement, SettlementShare, Share } from "./types";

type DbError = { code?: string; message?: string; hint?: string } | null;

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
  has_payments: "Something was already paid for this purchase",
  not_settled: "Settle up with everyone first",
  stale: "The amounts changed since the payment was marked",
  invalid_link: "The reset link is invalid or expired",
  signup_unavailable: "Sign-up is unavailable",
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
  else if (error.code === "23514" && message.includes("has_payments")) code = "has_payments";
  else if (error.code === "23514" && message.includes("not_settled")) code = "not_settled";
  else if (["23514", "23503", "23505", "22023", "22P02"].includes(error.code ?? "")) code = "invalid";
  else if (error.code === "P0002") code = "not_found";
  else if (message.includes("rate_limited")) code = "rate_limited";
  else if (message.includes("join_failed")) code = "join_failed";
  else if (message.includes("profile_required")) code = "profile_required";
  // the cooldown RPC puts the seconds left into the HINT
  const retry = code === "rate_limited" ? Number(error.hint) : NaN;
  return new RepoError(code, MESSAGES[code], Number.isInteger(retry) && retry > 0 ? retry : undefined);
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
      if (error) {
        const mapped = mapAuthError(error);
        // a 5xx / unexpected_failure means the server (usually SMTP with «Confirm email» ON) is broken: tell the user plainly
        if (mapped.code === "unknown" && (error.code === "unexpected_failure" || (error.status ?? 0) >= 500)) {
          debugLog("signUp", "server error: if 'Confirm email' is ON in Supabase Auth, switch it off or fix SMTP");
          throw new RepoError("signup_unavailable", MESSAGES.signup_unavailable);
        }
        throw mapped;
      }
      // "Confirm email" ON would hide an existing account behind a user without identities and give no session
      if (data.user && data.user.identities?.length === 0) throw new RepoError("email_taken", MESSAGES.email_taken);
      if (!data.user || !data.session) {
        debugLog("signUp", "no session: is 'Confirm email' still ON in the Supabase Auth settings?");
        throw new RepoError("signup_unavailable", MESSAGES.signup_unavailable);
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

    async requestPasswordReset(email, redirectTo) {
      const e = emailSchema.safeParse(email);
      if (!e.success) throw new RepoError("invalid", firstIssue(e.error));
      const { error } = await client.auth.resetPasswordForEmail(e.data, { redirectTo });
      if (!error) return;
      const mapped = mapAuthError(error);
      // only a rate limit is shown; every other failure looks like success so the screen never reveals whether an account exists
      if (mapped.code === "rate_limited") throw mapped;
      debugLog("resetPasswordForEmail", error);
    },

    async startPasswordRecovery(link) {
      let error: AuthError | null = null;
      if (link.code) ({ error } = await client.auth.exchangeCodeForSession(link.code));
      else if (link.tokenHash) ({ error } = await client.auth.verifyOtp({ type: "recovery", token_hash: link.tokenHash }));
      else throw new RepoError("invalid_link", MESSAGES.invalid_link);
      if (error) {
        debugLog("recovery", error);
        throw new RepoError("invalid_link", MESSAGES.invalid_link);
      }
    },

    async updatePassword(password) {
      if (!passwordSchema.safeParse(password).success) throw new RepoError("weak_password", MESSAGES.weak_password);
      const { error } = await client.auth.updateUser({ password });
      if (error) throw mapAuthError(error);
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

    async createPurchaseCustom(raw: NewCustomPurchase) {
      const parsed = createPurchaseCustomSchema.safeParse(raw);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      const input = parsed.data;
      const row = ok<PurchaseRow>(
        await client.rpc("create_purchase_custom", {
          p_household: input.household_id,
          p_amount: input.amount,
          p_description: input.description,
          p_merchant: input.merchant ? input.merchant : null,
          p_shares: input.shares.map(({ user_id, amount }) => ({ user_id, amount })),
        }),
      );
      if (!Array.isArray(row.shares)) throw new RepoError("unknown", MESSAGES.unknown);
      return toPurchase(row);
    },

    async deletePurchase(purchaseId) {
      const { error } = await client.rpc("delete_purchase", { p_id: purchaseId });
      if (error) throw mapDbError(error);
    },

    async updatePurchaseDescription(purchaseId, description) {
      const parsed = descriptionSchema.safeParse(description);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      const row = ok<PurchaseRow>(await client.rpc("update_purchase_description", { p_id: purchaseId, p_text: parsed.data }));
      if (!Array.isArray(row.shares)) throw new RepoError("unknown", MESSAGES.unknown);
      return toPurchase(row);
    },

    async setRemindersEnabled(householdId, enabled) {
      const { error } = await client.rpc("set_reminders_enabled", { p_household: householdId, p_enabled: enabled });
      if (error) throw mapDbError(error);
    },

    async remind(secret, householdId, debtorId) {
      return ok<ReminderTarget>(await client.rpc("remind", { p_secret: secret, p_household: householdId, p_debtor: debtorId }));
    },

    async runDailyReminders(secret) {
      return ok<ReminderTarget[]>(await client.rpc("run_daily_reminders", { p_secret: secret }));
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

    async getCaptureTokenInfo() {
      // the hash column is not selectable by clients: only the metadata is read
      const res = await client.from("capture_tokens").select("created_at, last_used_at").maybeSingle();
      if (res.error) throw mapDbError(res.error);
      return (res.data as CaptureTokenInfo | null) ?? null;
    },

    async rotateCaptureToken() {
      const token = ok<string>(await client.rpc("rotate_capture_token"));
      if (typeof token !== "string" || token.length < 20) throw new RepoError("unknown", MESSAGES.unknown);
      return token;
    },

    async capture(token, amount, merchant) {
      return ok<CaptureResult>(await client.rpc("capture_purchase", { p_token: token, p_amount: amount, p_merchant: merchant ?? null }));
    },

    async prunePushSubscription(token, endpoint) {
      const { error } = await client.rpc("prune_push_subscription", { p_token: token, p_endpoint: endpoint });
      if (error) throw mapDbError(error);
    },

    async listPending(householdId) {
      const me = await currentUser();
      if (!me) throw new RepoError("unauthenticated", MESSAGES.unauthenticated);
      const res = await client
        .from("purchases")
        .select("*, shares(*)")
        .eq("household_id", householdId)
        .eq("status", "pending")
        .eq("payer_id", me.user_id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      return ok<PurchaseRow[]>(res).map(toPurchase);
    },

    async resolvePending(purchaseId, raw) {
      const parsed = resolvePendingSchema.safeParse(raw);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      const input = parsed.data;
      const row = ok<PurchaseRow>(
        await client.rpc("resolve_pending", {
          p_purchase_id: purchaseId,
          p_shared: input.shared,
          p_description: input.description ?? null,
          p_participant_ids: input.shared ? (input.participant_ids ?? []) : [],
        }),
      );
      if (!Array.isArray(row.shares)) throw new RepoError("unknown", MESSAGES.unknown);
      return toPurchase(row);
    },

    async savePushSubscription(sub) {
      const parsed = pushSubscriptionSchema.safeParse(sub);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      const { error } = await client.rpc("save_push_subscription", {
        p_endpoint: parsed.data.endpoint,
        p_p256dh: parsed.data.p256dh,
        p_auth: parsed.data.auth,
      });
      if (error) throw mapDbError(error);
    },

    async deletePushSubscription(endpoint) {
      const { error } = await client.from("push_subscriptions").delete().eq("endpoint", endpoint);
      if (error) throw mapDbError(error);
    },

    async setDefaultHousehold(householdId) {
      const { error } = await client.rpc("set_default_household", { p_household_id: householdId });
      if (error) throw mapDbError(error);
    },

    async listBills(householdId) {
      const res = await client
        .from("bills")
        .select("*")
        .eq("household_id", householdId)
        .order("day_of_month", { ascending: true })
        .order("id", { ascending: true });
      return ok<Bill[]>(res);
    },

    async upsertBill(raw) {
      const parsed = billSchema.safeParse(raw);
      if (!parsed.success) throw new RepoError("invalid", firstIssue(parsed.error));
      const b = parsed.data;
      return ok<Bill>(
        await client.rpc("upsert_bill", {
          p_household: b.household_id,
          p_id: b.id ?? null,
          p_title: b.title,
          p_icon: b.icon,
          p_amount: b.variable ? null : b.amount,
          p_variable: b.variable,
          p_day: b.day_of_month,
          p_payer: b.payer_id,
          p_participants: b.participants,
        }),
      );
    },

    async deleteBill(billId) {
      const { error } = await client.rpc("delete_bill", { p_id: billId });
      if (error) throw mapDbError(error);
    },

    async setBillAmount(billId, month, amount) {
      if (!billMonthSchema.safeParse(month).success || !tengeSchema.safeParse(amount).success) throw new RepoError("invalid", "Invalid input");
      const row = ok<PurchaseRow>(await client.rpc("set_bill_amount", { p_bill: billId, p_month: month, p_amount: amount }));
      if (!Array.isArray(row.shares)) throw new RepoError("unknown", MESSAGES.unknown);
      return toPurchase(row);
    },

    async runMonthlyBills(secret) {
      return ok<MonthlyRun>(await client.rpc("run_monthly_bills", { p_secret: secret }));
    },

    async setMemberRole(householdId, userId, role) {
      const { error } = await client.rpc("set_member_role", { p_household: householdId, p_user: userId, p_role: role });
      if (error) throw mapDbError(error);
    },

    async removeMember(householdId, userId) {
      const { error } = await client.rpc("remove_member", { p_household: householdId, p_user: userId });
      if (error) throw mapDbError(error);
    },

    async leaveHousehold(householdId) {
      const { error } = await client.rpc("leave_household", { p_household: householdId });
      if (error) throw mapDbError(error);
    },

    async rotateInviteCode(householdId) {
      return ok<Household>(await client.rpc("rotate_invite_code", { p_household: householdId }));
    },

    async setAway(householdId, until) {
      if (until !== null && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new RepoError("invalid", "Invalid date");
      const { error } = await client.rpc("set_away", { p_household: householdId, p_until: until });
      if (error) throw mapDbError(error);
    },
  };
}

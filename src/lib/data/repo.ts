import type {
  Bill,
  BillInput,
  CaptureResult,
  CaptureTokenInfo,
  Household,
  Member,
  MonthlyRun,
  Profile,
  Purchase,
  PushSubscriptionInput,
  ReminderTarget,
  Settlement,
  Share,
  Uuid,
} from "./types";
import type { ResolvePendingInput } from "@/lib/domain/schemas";

export type MemberWithProfile = Member & { profile: Profile };
export type NewCustomPurchase = {
  household_id: Uuid;
  amount: number;
  description: string;
  merchant?: string | null;
  /** Explicit amount per person (the payer may be one of them); they must add up to `amount`. */
  shares: ReadonlyArray<{ user_id: Uuid; amount: number }>;
};

export type PurchaseWithShares = Purchase & { shares: Share[] };

export type AuthSession = { user_id: Uuid; email: string };

export type ProfileDraft = { display_name: string; kaspi_phone: string };

/** Equal-split manual purchase. The payer is always the current user; shares are computed server-side. */
export type NewPurchase = {
  household_id: Uuid;
  amount: number;
  description: string;
  merchant?: string | null;
  participant_ids: ReadonlyArray<Uuid>;
};

/**
 * Data access boundary. `mockRepo` (in-memory + localStorage) and `supabaseRepo` implement it,
 * and the same contract test runs against both. Inputs are validated with the shared zod schemas.
 */
/** What /reset received in its URL. `mock` is honoured by the mock backend only. */
export type RecoveryLink = { code?: string | null; tokenHash?: string | null; mock?: boolean; mockEmail?: string | null };

export interface Repo {
  /** The signed-in user, or null. */
  getSession(): Promise<AuthSession | null>;
  /**
   * Creates an account with email + password and signs in (email confirmation is OFF, so a session comes back at once).
   * invalid = malformed email, weak_password = shorter than 8 characters, email_taken = already registered.
   */
  signUp(email: string, password: string): Promise<AuthSession>;
  /** invalid_credentials covers a wrong password and an unknown email alike (nothing reveals which emails exist). */
  signIn(email: string, password: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  /**
   * «Забыли пароль?»: asks Supabase to mail a reset link that lands on `redirectTo`. Resolves the same way whether or not
   * the account exists (nothing reveals which emails are registered); only a malformed email or a rate limit throws.
   */
  requestPasswordReset(email: string, redirectTo: string): Promise<void>;
  /** /reset: turns the link's `code` (PKCE) or `token_hash` (OTP) into a recovery session. `invalid_link` when it is expired or used. */
  startPasswordRecovery(link: RecoveryLink): Promise<void>;
  /** Sets a new password for the signed-in (recovery) session. weak_password = shorter than 8 characters. */
  updatePassword(password: string): Promise<void>;

  /** The current user's profile, or null before onboarding. */
  getMe(): Promise<Profile | null>;
  upsertProfile(input: ProfileDraft): Promise<Profile>;

  listHouseholds(): Promise<Household[]>;
  listMembers(householdId: Uuid): Promise<MemberWithProfile[]>;
  listPurchases(householdId: Uuid): Promise<PurchaseWithShares[]>;
  createHousehold(name: string): Promise<Household>;
  /** Always fails with `join_failed` for any bad code (never reveals whether a code exists). */
  joinHousehold(inviteCode: string): Promise<Household>;
  createPurchase(input: NewPurchase): Promise<PurchaseWithShares>;
  /** «Свои суммы»: payer only; every entry an active member, no duplicates, integer amounts >= 0 that sum to the total, someone besides the payer. */
  createPurchaseCustom(input: NewCustomPurchase): Promise<PurchaseWithShares>;
  /**
   * Payer only. has_payments = a share was paid or a pending settlement covers it (nothing is deleted).
   * not_found = unknown or not visible, forbidden = a housemate's purchase.
   */
  deletePurchase(purchaseId: Uuid): Promise<void>;
  /** Payer only, 1..200 characters. */
  updatePurchaseDescription(purchaseId: Uuid, description: string): Promise<PurchaseWithShares>;
  /** Self only: whether the daily reminder may be sent to me in this household. */
  setRemindersEnabled(householdId: Uuid, enabled: boolean): Promise<void>;
  /**
   * SERVER ONLY (needs CRON_SECRET, so a browser cannot use it). The signed-in creditor reminds a debtor:
   * forbidden = not a creditor, rate_limited = 6h cooldown (RepoError.retryAfter = seconds left), unauthenticated = bad secret.
   */
  remind(secret: string, householdId: Uuid, debtorId: Uuid): Promise<ReminderTarget>;
  /** SERVER ONLY (anon client + CRON_SECRET): the reminders to send now; they are logged as sent. */
  runDailyReminders(secret: string): Promise<ReminderTarget[]>;

  /** Every settlement of the household, newest first (members only). */
  listSettlements(householdId: Uuid): Promise<Settlement[]>;
  /**
   * The debtor says "я оплатил". The amount is the pair's CURRENT net, computed by the backend (never passed in).
   * One open `marked` settlement per pair and direction: asking again returns the same row.
   * invalid = you do not owe this person, forbidden = not a member.
   */
  markSettlement(householdId: Uuid, toUserId: Uuid): Promise<Settlement>;
  /**
   * The creditor confirms: exactly the shares recorded at the mark are settled, in both directions. A second call
   * is a no-op returning the same row. forbidden = not the creditor, not_found = no such settlement (or not yours),
   * expectedAmount = the amount the creditor saw; if the record differs, it is stale.
   * stale = a recorded share was deleted, settled or changed since the mark: nothing is closed, cancel and mark again.
   */
  confirmSettlement(settlementId: Uuid, expectedAmount?: number): Promise<Settlement>;
  /** The debtor or the creditor withdraws a `marked` settlement (cancelling twice is a no-op). */
  cancelSettlement(settlementId: Uuid): Promise<Settlement>;

  /** Whether I have a capture token (hash never leaves the database). */
  getCaptureTokenInfo(): Promise<CaptureTokenInfo | null>;
  /** Creates (or replaces) my capture token and returns the plaintext ONCE; only its sha256 is stored. */
  rotateCaptureToken(): Promise<string>;
  /**
   * The token-authenticated capture the iOS Shortcut triggers (anon RPC). unauthenticated = unknown token (generic),
   * rate_limited = more than 30 per hour, invalid = bad amount or no household.
   */
  capture(token: string, amount: number, merchant?: string | null): Promise<CaptureResult>;
  /** Token-authenticated removal of a dead push endpoint of the token's owner. */
  prunePushSubscription(token: string, endpoint: string): Promise<void>;
  /** My pending (not yet resolved) Apple Pay purchases of a household, newest first. */
  listPending(householdId: Uuid): Promise<PurchaseWithShares[]>;
  /**
   * Payer only, only while pending. Shared: equal split among participant_ids (same rule as a new purchase).
   * Personal: only the description changes. Asking for the state it already has returns it unchanged;
   * not_found = not yours or no such purchase, invalid = the other state was chosen already.
   */
  resolvePending(purchaseId: Uuid, input: ResolvePendingInput): Promise<PurchaseWithShares>;
  /** Upsert by endpoint (a device that changes owner moves the subscription). */
  savePushSubscription(sub: PushSubscriptionInput): Promise<void>;
  /** Removes my subscription for this endpoint. */
  deletePushSubscription(endpoint: string): Promise<void>;
  /** Member only. */
  setDefaultHousehold(householdId: Uuid): Promise<void>;

  /** The household's monthly bills (members read). */
  listBills(householdId: Uuid): Promise<Bill[]>;
  /** Admin only. Creates (no id) or edits a bill; payer and participants must be active members. forbidden = not an admin. */
  upsertBill(input: BillInput): Promise<Bill>;
  /** Admin only. Generated purchases stay. */
  deleteBill(billId: Uuid): Promise<void>;
  /**
   * The payer or an admin enters a VARIABLE bill's amount for a due month ('YYYY-MM') that was not generated yet:
   * the month's purchase is created and returned. invalid = fixed bill, not due, already generated or bad amount.
   */
  setBillAmount(billId: Uuid, month: string, amount: number): Promise<PurchaseWithShares>;
  /**
   * SERVER ONLY (anon client + CRON_SECRET). Idempotent: creates the purchase of every FIXED bill that is due this month
   * (Asia/Almaty) and not generated yet, and returns notices for the payers of due VARIABLE bills still lacking an amount.
   */
  runMonthlyBills(secret: string): Promise<MonthlyRun>;

  /** Admin only. The last admin cannot be demoted (invalid). */
  setMemberRole(householdId: Uuid, userId: Uuid, role: "admin" | "member"): Promise<void>;
  /** Admin only, not yourself. not_settled = the member has a non-zero net with someone. */
  removeMember(householdId: Uuid, userId: Uuid): Promise<void>;
  /** Myself. not_settled = I have a non-zero net with someone; invalid = I am the only admin. */
  leaveHousehold(householdId: Uuid): Promise<void>;
  /** Admin only: a new invite code (the old one stops working). */
  rotateInviteCode(householdId: Uuid): Promise<Household>;
  /** Myself: away until a date ('YYYY-MM-DD', today or later) or null = at home. */
  setAway(householdId: Uuid, until: string | null): Promise<void>;
}

export type RepoErrorCode =
  | "unauthenticated"
  | "profile_required"
  | "not_found"
  | "invalid"
  | "forbidden"
  | "join_failed"
  | "invalid_credentials"
  | "email_taken"
  | "weak_password"
  | "rate_limited"
  | "has_payments"
  | "not_settled" // removing or leaving while a net with someone is non-zero
  | "stale"
  | "invalid_link" // the password reset link is expired, used or malformed
  | "signup_unavailable" // sign-up failed on the server (5xx / unexpected_failure, e.g. SMTP with «Confirm email» ON)
  | "unknown";

export class RepoError extends Error {
  constructor(
    readonly code: RepoErrorCode,
    message: string,
    /** rate_limited by a cooldown: seconds until the next try. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "RepoError";
  }
}

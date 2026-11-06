import type { Household, Member, Profile, Purchase, Settlement, Share, Uuid } from "./types";

export type MemberWithProfile = Member & { profile: Profile };
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
  | "stale"
  | "unknown";

export class RepoError extends Error {
  constructor(
    readonly code: RepoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RepoError";
  }
}

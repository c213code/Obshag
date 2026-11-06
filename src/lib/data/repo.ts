import type { Household, Member, Profile, Purchase, Share, Uuid } from "./types";

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
  /** Sends an email code (mock mode: sends nothing, the code is always 000000). */
  requestOtp(email: string): Promise<void>;
  verifyOtp(email: string, code: string): Promise<AuthSession>;
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
}

export type RepoErrorCode = "unauthenticated" | "profile_required" | "not_found" | "invalid" | "forbidden" | "join_failed" | "otp_failed" | "unknown";

export class RepoError extends Error {
  constructor(
    readonly code: RepoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RepoError";
  }
}

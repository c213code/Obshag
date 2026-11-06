import type { Household, Member, Profile, Purchase, PurchaseSource, PurchaseStatus, Share, Uuid } from "./types";

export type MemberWithProfile = Member & { profile: Profile };
export type PurchaseWithShares = Purchase & { shares: Share[] };

export type NewPurchase = {
  household_id: Uuid;
  amount: number;
  description: string;
  merchant?: string | null;
  source?: PurchaseSource;
  status?: PurchaseStatus;
  /** Defaults to the current user. */
  payer_id?: Uuid;
  shares: ReadonlyArray<{ debtor_id: Uuid; amount: number }>;
};

/** Data access boundary. Slice 1 adds a Supabase implementation next to `mockRepo`. */
export interface Repo {
  getMe(): Promise<Profile>;
  listHouseholds(): Promise<Household[]>;
  listMembers(householdId: Uuid): Promise<MemberWithProfile[]>;
  listPurchases(householdId: Uuid): Promise<PurchaseWithShares[]>;
  createHousehold(name: string): Promise<Household>;
  joinHousehold(inviteCode: string): Promise<Household>;
  createPurchase(input: NewPurchase): Promise<PurchaseWithShares>;
}

export class RepoError extends Error {
  constructor(
    readonly code: "not_found" | "invalid" | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "RepoError";
  }
}

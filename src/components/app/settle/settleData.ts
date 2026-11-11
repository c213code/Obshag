import { coveredShares, netForUser, netPair, withoutInFlight, type PairNet, type UserNet } from "@/lib/domain/netting";
import type { Settlement } from "@/lib/data/types";
import type { MemberWithProfile } from "@/lib/data/repo";
import type { Snapshot } from "../snapshot";

/** A marked settlement addressed to me, with the person who made it and how many shares confirming closes. */
export type Incoming = { settlement: Settlement; from: MemberWithProfile; covered: number };

export type SettleData = {
  meId: string;
  householdId: string;
  members: ReadonlyArray<MemberWithProfile>;
  /** Totals count everyone; `counterparties[].active` is false for neighbours who left (read-only, never a redirect target). */
  net: UserNet;
  /** Marked settlements I must confirm, oldest first. */
  incoming: Incoming[];
  /** My own open `marked` settlements (I said "я оплатил"). */
  outgoing: Settlement[];
  pairWith(userId: string): PairNet;
  memberOf(userId: string): MemberWithProfile | undefined;
};

/** Everything the settle screens and Главная's «Подтверди оплату» need for the active household. Computed once by the provider. */
export function buildSettleData(snap: Snapshot, activeId: string | null): SettleData | null {
  const { me, members, purchases, settlements } = snap;
  if (!me || !activeId) return null;
  const ms = members[activeId] ?? [];
  const ps = purchases[activeId] ?? [];
  const shares = ps.flatMap((p) => p.shares);
  const open = (settlements[activeId] ?? []).filter((s) => s.status === "marked");
  // slice 19: a transfer that is marked but not yet confirmed counts as paid for every number below (the rows stay open)
  const netShares = withoutInFlight(shares, open);
  const byId = new Map(ms.map((m) => [m.user_id, m]));
  const incoming = open
    .filter((s) => s.to_id === me.id)
    .flatMap((s): Incoming[] => {
      const from = byId.get(s.from_id);
      return from ? [{ settlement: s, from, covered: coveredShares(s, shares, ps).length }] : [];
    })
    .sort((a, b) => a.settlement.marked_at.localeCompare(b.settlement.marked_at) || a.settlement.id.localeCompare(b.settlement.id));
  return {
    meId: me.id,
    householdId: activeId,
    members: ms,
    net: netForUser(me.id, netShares, ps, (id) => byId.has(id)),
    incoming,
    outgoing: open.filter((s) => s.from_id === me.id),
    pairWith: (userId) => netPair(me.id, userId, netShares, ps),
    memberOf: (userId) => byId.get(userId),
  };
}

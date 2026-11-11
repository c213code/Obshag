import { orderSplit, type OrderInput } from "@/lib/domain/orders";
import { RepoError } from "./repo";
import type { MockDb } from "./seed";
import type { Purchase, Uuid } from "./types";

/**
 * The mock twin of private.insert_shares_with_orders (0016): validates the orders and the participants, then writes
 * purchase_orders and the shares (equal part of the rest + own orders). Throws `invalid` like the SQL's 23514 / 23503.
 */
export function writeSharesWithOrders(
  db: MockDb,
  purchase: Purchase,
  participantIds: ReadonlyArray<Uuid>,
  orders: ReadonlyArray<OrderInput>,
  createdAt: string,
): void {
  const active = (id: Uuid) => db.members.some((m) => m.household_id === purchase.household_id && m.user_id === id && m.active);
  if (!participantIds.every(active)) throw new RepoError("invalid", "Every participant must be an active member of the household");
  if (!orders.every((o) => active(o.user_id))) throw new RepoError("invalid", "Every order must be from an active member");
  if (new Set(participantIds).size !== participantIds.length) throw new RepoError("invalid", "Duplicate participant");
  const split = orderSplit(purchase.amount, participantIds, orders, purchase.payer_id);
  if (split.issue) throw new RepoError("invalid", `Invalid orders (${split.issue})`);
  db.purchaseOrders ??= [];
  for (const o of orders) {
    db.purchaseOrders.push({ purchase_id: purchase.id, user_id: o.user_id, amount: o.amount, note: o.note?.trim() ? o.note.trim() : null });
  }
  for (const s of split.shares) {
    db.shares.push({
      purchase_id: purchase.id,
      debtor_id: s.debtor_id,
      amount: s.amount,
      settled_at: s.debtor_id === purchase.payer_id ? createdAt : null,
      settlement_id: null,
    });
  }
}


import { parseAmountText } from "./customSplit";
import { splitEqual } from "./split";

/** One personal order inside a shared purchase («+ Заказ»): somebody asked to buy something just for them. */
export type OrderInput = { user_id: string; amount: number; note?: string | null };

export const MAX_ORDERS = 20;
export const ORDER_NOTE_MAX = 60;

export type OrderIssue = "payer" | "empty" | "too_many" | "too_big" | "rest_small" | "no_participants";

export type OrderSplit = {
  /** total - sum(orders): what is split equally among the participants. */
  rest: number;
  ordersTotal: number;
  /** One entry per person who owes (participants first in their order, then people who only ordered). */
  shares: Array<{ debtor_id: string; amount: number; settled: boolean }>;
  /** The equal part every participant gets before orders (the lower value when the rest does not divide). */
  each: { min: number; max: number };
  issue: OrderIssue | null;
};

/**
 * Mirror of private.insert_shares_with_orders (0016): rest = total - orders is split like splitEqual among the participants,
 * every person's share = equal part + own orders. A person who ordered need not be a participant. The payer cannot order
 * from himself, and the rest must give every participant at least 1 tenge.
 */
export function orderSplit(total: number, participantIds: ReadonlyArray<string>, orders: ReadonlyArray<OrderInput>, payerId: string): OrderSplit {
  const ordersTotal = orders.reduce((s, o) => s + o.amount, 0);
  const rest = total - ordersTotal;
  const n = participantIds.length;
  const empty = (issue: OrderIssue): OrderSplit => ({ rest, ordersTotal, shares: [], each: { min: 0, max: 0 }, issue });
  if (orders.length > MAX_ORDERS) return empty("too_many");
  if (orders.some((o) => o.user_id === payerId)) return empty("payer");
  if (orders.some((o) => !Number.isInteger(o.amount) || o.amount < 1)) return empty("empty");
  if (n < 1) return empty("no_participants");
  if (!Number.isInteger(total) || total < 1 || rest < 1) return empty("too_big");
  if (rest < n) return empty("rest_small");

  const byPerson = new Map<string, number>();
  for (const o of orders) byPerson.set(o.user_id, (byPerson.get(o.user_id) ?? 0) + o.amount);
  const equal = splitEqual(rest, participantIds, payerId);
  const shares = equal.map((s) => ({ debtor_id: s.debtor_id, amount: s.amount + (byPerson.get(s.debtor_id) ?? 0), settled: s.settled }));
  for (const [user, amount] of byPerson) {
    if (!participantIds.includes(user)) shares.push({ debtor_id: user, amount, settled: false });
  }
  const min = Math.floor(rest / n);
  return { rest, ordersTotal, shares, each: { min, max: rest % n === 0 ? min : min + 1 }, issue: null };
}

/** Rows with an amount of 0 (not filled in yet) are dropped before sending; the note is trimmed, empty becomes null. */
export function cleanOrders(rows: ReadonlyArray<{ user_id: string; amount: number; note?: string | null }>): OrderInput[] {
  return rows
    .filter((r) => r.user_id !== "" && r.amount > 0)
    .map((r) => ({ user_id: r.user_id, amount: r.amount, note: r.note?.trim() ? r.note.trim().slice(0, ORDER_NOTE_MAX) : null }));
}

/** An order row as typed in the form: the amount is text until it is parsed. */
export type OrderDraft = { key: string; user_id: string | null; amount: string; note: string };

/**
 * Turns the typed rows into orders. A row that has no person or no amount yet is `incomplete` (it is not sent, and the form
 * asks to finish or remove it); completely empty rows do not count as incomplete only when they are untouched (no person, no amount).
 */
export function draftsToOrders(drafts: ReadonlyArray<OrderDraft>): { orders: OrderInput[]; incomplete: boolean } {
  const orders: OrderInput[] = [];
  let incomplete = false;
  for (const d of drafts) {
    const amount = parseAmountText(d.amount) ?? 0;
    if (d.user_id && amount > 0) orders.push({ user_id: d.user_id, amount, note: d.note.trim() ? d.note.trim().slice(0, ORDER_NOTE_MAX) : null });
    else incomplete = true;
  }
  return { orders, incomplete };
}

/** The rows of an existing purchase, for the edit sheet. */
export function ordersToDrafts(orders: ReadonlyArray<OrderInput>): OrderDraft[] {
  return orders.map((o, i) => ({ key: `o${i}`, user_id: o.user_id, amount: String(o.amount), note: o.note ?? "" }));
}

/**
 * Is this purchase an equal split plus orders (what the edit sheet can rebuild)? Returns who takes part in the equal split
 * and the orders, or null when the shares are «свои суммы» (those keep the plain description edit). The participant order is
 * unknown for a saved purchase, so only the shape is checked: every part is the base or base + 1, the payer's own part is
 * the base, and the number of base + 1 parts equals the remainder.
 */
export function deriveEqual(p: {
  payer_id: string;
  amount: number;
  shares: ReadonlyArray<{ debtor_id: string; amount: number }>;
  orders?: ReadonlyArray<{ user_id: string; amount: number; note?: string | null }>;
}): { participants: string[]; orders: OrderInput[] } | null {
  const orders: OrderInput[] = (p.orders ?? []).map((o) => ({ user_id: o.user_id, amount: o.amount, note: o.note ?? null }));
  if (orders.some((o) => o.user_id === p.payer_id)) return null;
  const ordered = new Map<string, number>();
  for (const o of orders) ordered.set(o.user_id, (ordered.get(o.user_id) ?? 0) + o.amount);
  const parts = p.shares.map((s) => ({ id: s.debtor_id, part: s.amount - (ordered.get(s.debtor_id) ?? 0) }));
  if (parts.some((x) => x.part < 0)) return null;
  if ([...ordered.keys()].some((id) => !p.shares.some((s) => s.debtor_id === id))) return null;
  const takers = parts.filter((x) => x.part > 0);
  const n = takers.length;
  const rest = p.amount - orders.reduce((s, o) => s + o.amount, 0);
  if (n < 1 || rest < n) return null;
  const base = Math.floor(rest / n);
  const rem = rest - base * n;
  if (takers.some((x) => x.part !== base && x.part !== base + 1)) return null;
  const payerPart = takers.find((x) => x.id === p.payer_id);
  if (payerPart && payerPart.part !== base) return null;
  if (takers.filter((x) => x.part === base + 1).length !== rem) return null;
  const ids = takers.map((x) => x.id);
  const participants = [...ids.filter((id) => id === p.payer_id), ...ids.filter((id) => id !== p.payer_id)];
  return { participants, orders };
}

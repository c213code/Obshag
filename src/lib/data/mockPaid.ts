import { isTransferable } from "@/lib/domain/minTransfer";
import { netPair } from "@/lib/domain/netting";
import { newId } from "@/lib/domain/uuid";
import { RepoError, type Repo } from "./repo";
import type { MockDb } from "./seed";
import type { PaidAnswerResult, PaidPrompt, PaidPromptNotice, Settlement, Uuid } from "./types";

type Ctx = {
  tx<T>(fn: (db: MockDb) => T): Promise<T>;
  uid(): Uuid;
  now(): Date;
  requireSecret(secret: string): void;
  subscriptionsOf(db: MockDb, userId: Uuid): Array<{ endpoint: string; p256dh: string; auth: string }>;
  /** The mark path of mockRepo (SQL private.mark_settlement_for). */
  markIn(db: MockDb, actor: Uuid, householdId: Uuid, toUserId: Uuid): Settlement;
};

export type MockPaidApi = Pick<Repo, "openPaidPrompt" | "listPaidPrompts" | "answerPaidPrompt" | "paidPromptNotice" | "tgAnswerPaid">;

/** A pending prompt older than this is expired (lazily, on read). */
export const PROMPT_TTL_MS = 30 * 60_000;
/** paid_prompt_notice only asks once the prompt is at least this old. */
export const PROMPT_ASK_AFTER_MS = 120_000;

/** In-memory twin of the slice 17 SQL (0015). Rules and error codes match it. */
export function createMockPaid(ctx: Ctx): MockPaidApi {
  const isMember = (db: MockDb, householdId: Uuid, userId: Uuid) =>
    db.members.some((m) => m.household_id === householdId && m.user_id === userId && m.active);
  const net = (db: MockDb, householdId: Uuid, from: Uuid, to: Uuid) => {
    const purchases = db.purchases.filter((p) => p.household_id === householdId);
    const ids = new Set(purchases.map((p) => p.id));
    return netPair(from, to, db.shares.filter((s) => ids.has(s.purchase_id)), purchases);
  };
  const expire = (db: MockDb) => {
    const t = ctx.now().getTime();
    for (const p of db.paidPrompts ?? []) if (p.status === "pending" && t - Date.parse(p.opened_at) > PROMPT_TTL_MS) p.status = "expired";
  };

  /** SQL private.paid_prompt_answer; the actor is authenticated by the caller. */
  const answer = (db: MockDb, actor: Uuid, promptId: Uuid, yes: boolean): PaidAnswerResult => {
    const p = (db.paidPrompts ?? []).find((x) => x.id === promptId);
    if (!p || p.from_user !== actor) throw new RepoError("forbidden", "Not allowed");
    const to_name = db.profiles.find((x) => x.id === p.to_user)?.display_name ?? "";
    const done = (result: PaidAnswerResult["result"]): PaidAnswerResult => ({ result, to_name });
    if (p.status === "pending" && ctx.now().getTime() - Date.parse(p.opened_at) > PROMPT_TTL_MS) {
      p.status = "expired";
      return done("expired");
    }
    if (p.status !== "pending") return done(p.status === "expired" ? "expired" : "already");
    if (!yes) {
      p.status = "no";
      return done("no");
    }
    const pair = net(db, p.household_id, p.from_user, p.to_user);
    if (pair.direction !== "i_pay" || !isMember(db, p.household_id, p.to_user)) {
      p.status = "expired";
      return done("stale");
    }
    if (!isTransferable(pair.net)) {
      p.status = "expired";
      return done("too_small");
    }
    const open = db.settlements.some((s) => s.household_id === p.household_id && s.from_id === p.from_user && s.to_id === p.to_user && s.status === "marked");
    if (!open) ctx.markIn(db, p.from_user, p.household_id, p.to_user);
    p.status = "yes";
    return done("marked");
  };

  return {
    async openPaidPrompt(householdId, toUser) {
      const id = ctx.uid();
      return ctx.tx((db): PaidPrompt => {
        if (!householdId || !toUser || !isMember(db, householdId, id)) throw new RepoError("forbidden", "Not a member of this household");
        if (toUser === id) throw new RepoError("invalid", "Cannot settle with yourself");
        if (!isMember(db, householdId, toUser)) throw new RepoError("invalid", "Counterparty is not an active member");
        const pair = net(db, householdId, id, toUser);
        if (pair.direction !== "i_pay") throw new RepoError("invalid", "You do not owe this person");
        if (!isTransferable(pair.net)) throw new RepoError("too_small", "Below the Kaspi minimum");
        expire(db);
        db.paidPrompts ??= [];
        const now = ctx.now().toISOString();
        const open = db.paidPrompts.find((p) => p.household_id === householdId && p.from_user === id && p.to_user === toUser && p.status === "pending");
        if (open) {
          open.opened_at = now;
          open.amount = pair.net;
          open.asked_at = null;
          return structuredClone(open);
        }
        const row: PaidPrompt = { id: newId(), household_id: householdId, from_user: id, to_user: toUser, amount: pair.net, opened_at: now, status: "pending", asked_at: null };
        db.paidPrompts.push(row);
        return structuredClone(row);
      });
    },

    async listPaidPrompts(householdId) {
      const id = ctx.uid();
      return ctx.tx((db) => {
        if (!isMember(db, householdId, id)) throw new RepoError("forbidden", "Not a member of this household");
        expire(db);
        return (db.paidPrompts ?? [])
          .filter((p) => p.household_id === householdId && p.from_user === id && p.status === "pending")
          .sort((a, b) => b.opened_at.localeCompare(a.opened_at) || a.id.localeCompare(b.id))
          .map((p) => structuredClone(p));
      });
    },

    async answerPaidPrompt(promptId, yes) {
      const id = ctx.uid();
      return ctx.tx((db) => answer(db, id, promptId, yes));
    },

    async paidPromptNotice(secret, promptId) {
      ctx.requireSecret(secret);
      const id = ctx.uid();
      return ctx.tx((db): PaidPromptNotice => {
        const p = (db.paidPrompts ?? []).find((x) => x.id === promptId);
        if (!p || p.from_user !== id) throw new RepoError("forbidden", "Not allowed");
        expire(db);
        if (p.status !== "pending" || p.asked_at !== null || ctx.now().getTime() - Date.parse(p.opened_at) < PROMPT_ASK_AFTER_MS) return { ask: false };
        p.asked_at = ctx.now().toISOString();
        const to = db.profiles.find((x) => x.id === p.to_user);
        return {
          ask: true,
          prompt_id: p.id,
          household_id: p.household_id,
          to_user: p.to_user,
          to_name: to?.display_name ?? "",
          to_username: to?.telegram_username ?? null,
          amount: p.amount,
          telegram_user_id: db.profiles.find((x) => x.id === id)?.telegram_user_id ?? null,
          subscriptions: ctx.subscriptionsOf(db, id),
        };
      });
    },

    async tgAnswerPaid(secret, tgUserId, promptId, yes) {
      ctx.requireSecret(secret);
      return ctx.tx((db) => {
        const actor = db.profiles.find((x) => x.telegram_user_id === tgUserId);
        if (!actor) throw new RepoError("forbidden", "Not allowed");
        return answer(db, actor.id, promptId, yes);
      });
    },
  };
}

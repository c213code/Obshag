import { almatyDay } from "@/lib/domain/almaty";
import {
  DOW_SHORT,
  DONE_LOCK_HOUR,
  SWAP_REASON_MAX,
  addDays,
  dayDiff,
  dayOfMonth,
  isoDow,
  resolveDay,
  swapExpiresAt,
  type DutyState,
} from "@/lib/domain/duty";
import { defaultParticipants } from "@/lib/domain/away";
import { EMPTY_COOLDOWN_S, PING_COOLDOWN_S, currentOf, waterPlan } from "@/lib/domain/dutyEvents";
import { splitEqual } from "@/lib/domain/split";
import { newId } from "@/lib/domain/uuid";
import { RepoError, type Repo } from "./repo";
import type { MockDb } from "./seed";
import type { Duty, DutyDay, DutyEvent, DutyKind, DutyMorningItem, DutyNotice, Purchase, Share, SwapRequest, Uuid } from "./types";

type Ctx = {
  tx<T>(fn: (db: MockDb) => T): Promise<T>;
  read<T>(fn: (db: MockDb) => T): Promise<T>;
  uid(): Uuid;
  now(): Date;
  requireSecret(secret: string): void;
  subscriptionsOf(db: MockDb, userId: Uuid): Array<{ endpoint: string; p256dh: string; auth: string }>;
};

export type MockDutyApi = Pick<
  Repo,
  | "listDuties"
  | "dutySchedule"
  | "listSwapRequests"
  | "getSwapRequest"
  | "createDuty"
  | "setDutyOrder"
  | "adminAssignDay"
  | "markDutyDone"
  | "requestSwap"
  | "respondSwap"
  | "cancelSwap"
  | "swapNotice"
  | "runDutyMorning"
  | "tgRespondSwap"
  | "listDutyEvents"
  | "dutyDoneEvent"
  | "dutyPing"
  | "waterEmpty"
  | "waterBrought"
  | "waterBottleUsed"
  | "setWaterPrice"
  | "dutyEventNotice"
>;

const KINDS: ReadonlyArray<DutyKind> = ["cooking", "trash", "water", "custom"];
const UNIQUE_KINDS: ReadonlyArray<DutyKind> = ["cooking", "trash", "water"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE = 62;

const invalid = (m = "Invalid input") => new RepoError("invalid", m);
const forbidden = () => new RepoError("forbidden", "Not allowed");
const denied = (code: "busy" | "stale" | "not_assignee" | "past_day" | "future_day" | "locked" | "expired") => new RepoError(code, code);

/** In-memory twin of the slice 14 SQL (duties, schedule, swaps, done, the morning run). Rules and error codes match 0012. */
export function createMockDuty(ctx: Ctx): MockDutyApi {
  const today = () => almatyDay(ctx.now()).date;
  const almatyHour = () => new Date(ctx.now().getTime() + 5 * 3_600_000).getUTCHours();

  const memberOf = (db: MockDb, householdId: Uuid, userId: Uuid) =>
    db.members.find((m) => m.household_id === householdId && m.user_id === userId && m.active);
  /** The duty, or forbidden when the caller is not in its household (a missing duty looks the same). */
  const visibleDuty = (db: MockDb, id: Uuid, userId: Uuid): Duty => {
    const d = (db.duties ?? []).find((x) => x.id === id);
    if (!d || !memberOf(db, d.household_id, userId)) throw forbidden();
    return d;
  };
  const adminDuty = (db: MockDb, id: Uuid, userId: Uuid): Duty => {
    const d = visibleDuty(db, id, userId);
    if (memberOf(db, d.household_id, userId)?.role !== "admin") throw forbidden();
    return d;
  };
  const stateOf = (db: MockDb, d: Duty): DutyState => ({
    duty: d,
    roster: db.members.filter((m) => m.household_id === d.household_id).map((m) => ({ user_id: m.user_id, active: m.active, away_until: m.away_until })),
    overrides: new Map((db.dutyOverrides ?? []).filter((o) => o.duty_id === d.id).map((o) => [o.day, { user_id: o.user_id, source: o.source }])),
    done: new Map((db.dutyDone ?? []).filter((x) => x.duty_id === d.id).map((x) => [x.day, x.user_id])),
    today: today(),
  });
  const assignee = (db: MockDb, d: Duty, day: string): Uuid | null => resolveDay(stateOf(db, d), day)?.user_id ?? null;
  const clean = (r: SwapRequest): SwapRequest => structuredClone(r);
  const tag = (db: MockDb, id: Uuid) => {
    const p = db.profiles.find((x) => x.id === id);
    return p?.telegram_username ? `@${p.telegram_username}` : p?.display_name || "?";
  };
  const label = (day: string) => `${DOW_SHORT[isoDow(day)]} ${dayOfMonth(day)}`;
  const expireDue = (db: MockDb, dutyId: Uuid | null) => {
    const t = ctx.now().getTime();
    for (const r of db.swapRequests ?? []) {
      if ((dutyId === null || r.duty_id === dutyId) && r.status === "pending" && Date.parse(r.expires_at) <= t) {
        r.status = "expired";
        r.decided_at = ctx.now().toISOString();
      }
    }
  };
  /** Normalises an order (null/empty = join order); distinct active members only. */
  const cleanOrder = (db: MockDb, householdId: Uuid, order: ReadonlyArray<Uuid> | null | undefined): Uuid[] => {
    if (!order || order.length === 0) {
      const ids = db.members
        .filter((m) => m.household_id === householdId && m.active)
        .sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.user_id.localeCompare(b.user_id))
        .map((m) => m.user_id);
      if (ids.length === 0) throw invalid("No members");
      return ids;
    }
    if (order.length > 20 || new Set(order).size !== order.length || order.some((u) => !memberOf(db, householdId, u))) throw invalid("Invalid order");
    return [...order];
  };
  const notice = (db: MockDb, r: SwapRequest, target: Uuid): DutyNotice => ({
    request_id: r.id,
    target_user: target,
    subscriptions: ctx.subscriptionsOf(db, target),
    telegram_user_id: db.profiles.find((p) => p.id === target)?.telegram_user_id ?? null,
    from_name: tag(db, r.from_user),
    to_name: tag(db, r.to_user),
    from_day: r.from_day,
    to_day: r.to_day,
    from_label: label(r.from_day),
    to_label: label(r.to_day),
    reason: r.reason,
  });

  /** private.duty_respond: the one place a swap is decided. */
  function respond(db: MockDb, actor: Uuid, requestId: Uuid, accept: boolean): SwapRequest {
    const r = (db.swapRequests ?? []).find((x) => x.id === requestId);
    const d = r ? (db.duties ?? []).find((x) => x.id === r.duty_id) : undefined;
    if (!r || !d || r.to_user !== actor || !memberOf(db, d.household_id, actor)) throw forbidden();
    const nowIso = ctx.now().toISOString();
    if (r.status === "pending" && Date.parse(r.expires_at) <= ctx.now().getTime()) {
      r.status = "expired";
      r.decided_at = nowIso;
      return r;
    }
    if (r.status === "expired") return r;
    if (r.status !== "pending") {
      if ((r.status === "accepted" && accept) || (r.status === "declined" && !accept)) return r;
      throw denied("stale");
    }
    if (!accept) {
      r.status = "declined";
      r.decided_at = nowIso;
      return r;
    }
    if (assignee(db, d, r.from_day) !== r.from_user || assignee(db, d, r.to_day) !== r.to_user) throw denied("stale");
    const overrides = (db.dutyOverrides ??= []);
    const put = (day: string, user_id: Uuid) => {
      const at = overrides.find((o) => o.duty_id === d.id && o.day === day);
      if (at) Object.assign(at, { user_id, source: "swap", reason: r.reason });
      else overrides.push({ duty_id: d.id, day, user_id, source: "swap", reason: r.reason });
    };
    put(r.from_day, r.to_user);
    put(r.to_day, r.from_user);
    r.status = "accepted";
    r.decided_at = nowIso;
    return r;
  }

  /** The duty of the expected kind for an active member (forbidden otherwise, invalid = wrong kind). */
  const eventDuty = (db: MockDb, id: Uuid, userId: Uuid, kind: "trash" | "water"): Duty => {
    const d = visibleDuty(db, id, userId);
    if (d.kind !== kind || !d.active) throw invalid("Invalid duty");
    return d;
  };
  const eventsOf = (db: MockDb, dutyId: Uuid) => (db.dutyEvents ?? []).filter((e) => e.duty_id === dutyId);
  const currentFor = (db: MockDb, d: Duty): Uuid | null =>
    currentOf(
      d.order,
      db.members.filter((m) => m.household_id === d.household_id).map((m) => ({ user_id: m.user_id, active: m.active, away_until: m.away_until })),
      eventsOf(db, d.id),
      today(),
    );
  const cooldown = (db: MockDb, dutyId: Uuid, kind: "ping" | "empty", windowS: number) => {
    const last = eventsOf(db, dutyId)
      .filter((e) => e.kind === kind)
      .reduce((m, e) => Math.max(m, Date.parse(e.created_at)), 0);
    const left = last ? Math.ceil((last + windowS * 1000 - ctx.now().getTime()) / 1000) : 0;
    if (left > 0) throw new RepoError("rate_limited", "Cooldown", left);
  };
  const addEvent = (db: MockDb, e: Omit<DutyEvent, "id" | "created_at">): DutyEvent => {
    const row: DutyEvent = { ...e, id: newId(), created_at: ctx.now().toISOString() };
    (db.dutyEvents ??= []).push(row);
    return row;
  };

  return {
    async listDutyEvents(dutyId) {
      const id = ctx.uid();
      return ctx.read((db) => {
        visibleDuty(db, dutyId, id);
        return structuredClone(
          eventsOf(db, dutyId)
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, 200),
        );
      });
    },

    async dutyDoneEvent(dutyId) {
      const id = ctx.uid();
      return ctx.tx((db) => {
        const d = eventDuty(db, dutyId, id, "trash");
        return structuredClone(addEvent(db, { duty_id: d.id, kind: "done", user_id: id, partner_id: null, liters: null, purchase_id: null }));
      });
    },

    async dutyPing(dutyId) {
      const id = ctx.uid();
      return ctx.tx((db) => {
        const d = eventDuty(db, dutyId, id, "trash");
        cooldown(db, d.id, "ping", PING_COOLDOWN_S);
        return structuredClone(addEvent(db, { duty_id: d.id, kind: "ping", user_id: id, partner_id: currentFor(db, d), liters: null, purchase_id: null }));
      });
    },

    async waterEmpty(dutyId) {
      const id = ctx.uid();
      return ctx.tx((db) => {
        const d = eventDuty(db, dutyId, id, "water");
        cooldown(db, d.id, "empty", EMPTY_COOLDOWN_S);
        const row = addEvent(db, { duty_id: d.id, kind: "empty", user_id: id, partner_id: currentFor(db, d), liters: null, purchase_id: null });
        d.bottles_full = 0;
        return structuredClone(row);
      });
    },

    async waterBrought(dutyId, partnerId) {
      const id = ctx.uid();
      return ctx.tx((db) => {
        const d = eventDuty(db, dutyId, id, "water");
        if (partnerId !== null && (partnerId === id || !memberOf(db, d.household_id, partnerId))) throw invalid("Invalid partner");
        const plan = waterPlan(partnerId === null ? "alone" : "pair", d.bottle_liters ?? 5, d.price_per_liter ?? 20);
        const roster = db.members.filter((m) => m.household_id === d.household_id && m.active);
        const people = defaultParticipants(roster, today());
        const createdAt = ctx.now().toISOString();
        const purchase: Purchase = {
          id: newId(),
          household_id: d.household_id,
          payer_id: id,
          amount: plan.amount,
          description: `Вода ${plan.liters} л`,
          merchant: null,
          source: "manual",
          status: "shared",
          created_at: createdAt,
        };
        const shares: Share[] = splitEqual(plan.amount, people, id).map((s) => ({
          purchase_id: purchase.id,
          debtor_id: s.debtor_id,
          amount: s.amount,
          settled_at: s.settled ? createdAt : null,
          settlement_id: null,
        }));
        db.purchases.push(purchase);
        db.shares.push(...shares);
        const row = addEvent(db, { duty_id: d.id, kind: "done", user_id: id, partner_id: partnerId, liters: plan.liters, purchase_id: purchase.id });
        d.bottles_full = Math.min(plan.bottles, d.bottles_total ?? 4);
        return structuredClone(row);
      });
    },

    async waterBottleUsed(dutyId) {
      const id = ctx.uid();
      return ctx.tx((db) => {
        const d = eventDuty(db, dutyId, id, "water");
        d.bottles_full = Math.max(0, (d.bottles_full ?? 0) - 1);
        return structuredClone(d);
      });
    },

    async setWaterPrice(dutyId, price) {
      const id = ctx.uid();
      return ctx.tx((db) => {
        const d = eventDuty(db, dutyId, id, "water");
        if (memberOf(db, d.household_id, id)?.role !== "admin") throw forbidden();
        if (!Number.isInteger(price) || price < 1 || price > 1000) throw invalid("Invalid price");
        d.price_per_liter = price;
        return structuredClone(d);
      });
    },

    async dutyEventNotice(secret, eventId) {
      ctx.requireSecret(secret);
      const id = ctx.uid();
      return ctx.read((db) => {
        const e = (db.dutyEvents ?? []).find((x) => x.id === eventId);
        if (!e || e.user_id !== id || e.kind === "done" || Date.parse(e.created_at) < ctx.now().getTime() - 600_000) throw forbidden();
        const self = e.partner_id === null || e.partner_id === id;
        return {
          event_id: e.id,
          kind: e.kind,
          title: (db.duties ?? []).find((x) => x.id === e.duty_id)?.title ?? "",
          target_user: e.partner_id,
          self,
          actor_name: db.profiles.find((p) => p.id === id)?.display_name || "?",
          subscriptions: self || !e.partner_id ? [] : ctx.subscriptionsOf(db, e.partner_id),
        };
      });
    },

    async listDuties(householdId) {
      const id = ctx.uid();
      return ctx.read((db) => {
        if (!memberOf(db, householdId, id)) throw forbidden();
        return structuredClone((db.duties ?? []).filter((d) => d.household_id === householdId && d.active));
      });
    },

    async dutySchedule(dutyId, from, to) {
      const id = ctx.uid();
      return ctx.read((db) => {
        const d = visibleDuty(db, dutyId, id);
        if (!ISO_DAY.test(from) || !ISO_DAY.test(to) || to < from || dayDiff(to, from) > MAX_RANGE) throw invalid("Invalid range");
        const state = stateOf(db, d);
        const t = ctx.now().getTime();
        const pending = (db.swapRequests ?? []).filter((r) => r.duty_id === d.id && r.status === "pending" && Date.parse(r.expires_at) > t);
        const out: DutyDay[] = [];
        for (let day = from; day <= to; day = addDays(day, 1)) {
          const r = resolveDay(state, day);
          if (!r) continue;
          out.push({
            day,
            user_id: r.user_id,
            source: r.source,
            done: state.done.has(day),
            request_id: pending.find((q) => q.from_day === day || q.to_day === day)?.id ?? null,
            skipped_user: r.source === "skip" ? r.plain : null,
          });
        }
        return out;
      });
    },

    async listSwapRequests(dutyId) {
      const id = ctx.uid();
      return ctx.read((db) => {
        visibleDuty(db, dutyId, id);
        return (db.swapRequests ?? [])
          .filter((r) => r.duty_id === dutyId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 30)
          .map(clean);
      });
    },

    async getSwapRequest(requestId) {
      const id = ctx.uid();
      return ctx.read((db) => {
        const r = (db.swapRequests ?? []).find((x) => x.id === requestId);
        const d = r ? (db.duties ?? []).find((x) => x.id === r.duty_id) : undefined;
        if (!r || !d || !memberOf(db, d.household_id, id)) throw new RepoError("not_found", "Request not found");
        return clean(r);
      });
    },

    async createDuty(input) {
      const id = ctx.uid();
      return ctx.tx((db) => {
        if (memberOf(db, input.household_id, id)?.role !== "admin") throw forbidden();
        const title = input.title.trim();
        if (!KINDS.includes(input.kind) || title.length < 1 || title.length > 40) throw invalid();
        if (input.start_date != null && !ISO_DAY.test(input.start_date)) throw invalid();
        const order = cleanOrder(db, input.household_id, input.order);
        if (
          UNIQUE_KINDS.includes(input.kind) &&
          (db.duties ?? []).some((d) => d.household_id === input.household_id && d.kind === input.kind && d.active)
        ) {
          throw invalid("Duty exists");
        }
        const duty: Duty = {
          id: newId(),
          household_id: input.household_id,
          kind: input.kind,
          title,
          start_date: input.start_date ?? today(),
          active: true,
          order,
          ...(input.kind === "water" ? { price_per_liter: 20, bottle_liters: 5, bottles_total: 4, bottles_full: 4 } : {}),
        };
        (db.duties ??= []).push(duty);
        return structuredClone(duty);
      });
    },

    async setDutyOrder(dutyId, order, startDate) {
      const id = ctx.uid();
      return ctx.tx((db) => {
        const d = adminDuty(db, dutyId, id);
        const next = cleanOrder(db, d.household_id, order);
        if (startDate != null && !ISO_DAY.test(startDate)) throw invalid();
        d.order = next;
        if (startDate != null) d.start_date = startDate;
        return structuredClone(d);
      });
    },

    async adminAssignDay(dutyId, day, userId) {
      const id = ctx.uid();
      await ctx.tx((db) => {
        const d = adminDuty(db, dutyId, id);
        if (!ISO_DAY.test(day) || day < today()) throw denied("past_day");
        if ((db.dutyDone ?? []).some((x) => x.duty_id === d.id && x.day === day)) throw denied("locked");
        if (userId !== null && !memberOf(db, d.household_id, userId)) throw invalid("Invalid member");
        const overrides = (db.dutyOverrides ??= []);
        const at = overrides.findIndex((o) => o.duty_id === d.id && o.day === day);
        if (userId === null) {
          if (at >= 0 && overrides[at].source === "admin") overrides.splice(at, 1);
        } else if (at >= 0) {
          Object.assign(overrides[at], { user_id: userId, source: "admin", reason: null });
        } else {
          overrides.push({ duty_id: d.id, day, user_id: userId, source: "admin", reason: null });
        }
        for (const r of db.swapRequests ?? []) {
          if (r.duty_id === d.id && r.status === "pending" && (r.from_day === day || r.to_day === day)) {
            r.status = "cancelled";
            r.decided_at = ctx.now().toISOString();
          }
        }
      });
    },

    async markDutyDone(dutyId, day) {
      const id = ctx.uid();
      await ctx.tx((db) => {
        const d = visibleDuty(db, dutyId, id);
        const t = today();
        if (!ISO_DAY.test(day) || day > t) throw denied("future_day");
        if (day < addDays(t, -1) || (day === addDays(t, -1) && almatyHour() >= DONE_LOCK_HOUR)) throw denied("locked");
        if (assignee(db, d, day) !== id) throw denied("not_assignee");
        const done = (db.dutyDone ??= []);
        if (!done.some((x) => x.duty_id === d.id && x.day === day)) done.push({ duty_id: d.id, day, user_id: id, done_at: ctx.now().toISOString() });
      });
    },

    async requestSwap(dutyId, myDay, otherDay, reason) {
      const id = ctx.uid();
      return ctx.tx((db) => {
        const d = visibleDuty(db, dutyId, id);
        const text = (reason ?? "").trim() || null;
        if (!ISO_DAY.test(myDay) || !ISO_DAY.test(otherDay) || myDay === otherDay || (text !== null && text.length > SWAP_REASON_MAX)) throw invalid();
        const t = today();
        if (myDay < t || otherDay < t) throw denied("past_day");
        expireDue(db, d.id);
        if (assignee(db, d, myDay) !== id) throw denied("not_assignee");
        const other = assignee(db, d, otherDay);
        if (!other || other === id) throw invalid();
        const touched = (r: SwapRequest) => [r.from_day, r.to_day].some((x) => x === myDay || x === otherDay);
        if ((db.swapRequests ?? []).some((r) => r.duty_id === d.id && r.status === "pending" && touched(r))) throw denied("busy");
        const expires_at = swapExpiresAt(myDay, otherDay);
        if (Date.parse(expires_at) <= ctx.now().getTime()) throw denied("expired");
        const req: SwapRequest = {
          id: newId(),
          duty_id: d.id,
          from_user: id,
          from_day: myDay,
          to_user: other,
          to_day: otherDay,
          reason: text,
          status: "pending",
          expires_at,
          created_at: ctx.now().toISOString(),
          decided_at: null,
        };
        (db.swapRequests ??= []).push(req);
        return clean(req);
      });
    },

    async respondSwap(requestId, accept) {
      const id = ctx.uid();
      return ctx.tx((db) => clean(respond(db, id, requestId, accept)));
    },

    async cancelSwap(requestId) {
      const id = ctx.uid();
      return ctx.tx((db) => {
        const r = (db.swapRequests ?? []).find((x) => x.id === requestId);
        if (!r || r.from_user !== id) throw forbidden();
        if (r.status === "pending") {
          const late = Date.parse(r.expires_at) <= ctx.now().getTime();
          r.status = late ? "expired" : "cancelled";
          r.decided_at = ctx.now().toISOString();
        } else if (r.status === "accepted") {
          throw denied("stale");
        }
        return clean(r);
      });
    },

    async swapNotice(secret, requestId, event) {
      ctx.requireSecret(secret);
      const id = ctx.uid();
      return ctx.read((db) => {
        const r = (db.swapRequests ?? []).find((x) => x.id === requestId);
        if (!r || (r.from_user !== id && r.to_user !== id)) throw forbidden();
        if (event === "requested" && id === r.from_user && r.status === "pending") return notice(db, r, r.to_user);
        if (event === "declined" && id === r.to_user && r.status === "declined") return notice(db, r, r.from_user);
        throw invalid();
      });
    },

    async runDutyMorning(secret) {
      ctx.requireSecret(secret);
      return ctx.tx((db) => {
        const t = today();
        db.dutyMorningLog = (db.dutyMorningLog ?? []).filter((l) => dayDiff(t, l.day) <= 14);
        expireDue(db, null);
        const out: DutyMorningItem[] = [];
        for (const d of [...(db.duties ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
          if (!d.active || d.order.length === 0 || d.kind === "trash" || d.kind === "water") continue;
          if ((db.dutyMorningLog ?? []).some((l) => l.duty_id === d.id && l.day === t)) continue;
          db.dutyMorningLog!.push({ duty_id: d.id, day: t });
          const cook = assignee(db, d, t);
          if (!cook) continue;
          const next = assignee(db, d, addDays(t, 1));
          out.push({
            duty_id: d.id,
            household_id: d.household_id,
            kind: d.kind,
            title: d.title,
            telegram_chat_id: null, // the group chat id lives only in the real database
            today_user: cook,
            today_name: tag(db, cook),
            tomorrow_user: next,
            tomorrow_name: next ? tag(db, next) : null,
            subscriptions: ctx.subscriptionsOf(db, cook),
          });
        }
        return out;
      });
    },

    async tgRespondSwap(secret, tgUserId, requestId, accept) {
      ctx.requireSecret(secret);
      return ctx.tx((db) => {
        const actor = db.profiles.find((p) => p.telegram_user_id === tgUserId);
        if (!actor) throw forbidden();
        let r: SwapRequest;
        try {
          r = respond(db, actor.id, requestId, accept);
        } catch (e) {
          if (e instanceof RepoError && e.code === "stale") return { result: "stale" as const, notice: null };
          throw e;
        }
        return { result: r.status as "accepted" | "declined" | "expired", notice: r.status === "declined" ? notice(db, r, r.from_user) : null };
      });
    },
  };
}

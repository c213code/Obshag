import { decline } from "@/lib/i18n/declension";
import { RepoError, type Repo } from "@/lib/data/repo";
import type { BillNotice, ReminderTarget } from "@/lib/data/types";
import { ru } from "@/lib/i18n/ru";
import { isMonthKey } from "@/lib/domain/almaty";
import { remindBodySchema } from "@/lib/domain/schemas";
import { bearerMatches } from "./cronAuth";
import type { PushSender } from "./push";

export type ReminderDeps = {
  repo: Pick<Repo, "remind" | "runDailyReminders" | "runMonthlyBills">;
  /** null = push is not configured: reminders are still logged, nothing is sent. */
  push: PushSender | null;
  secret: string;
};

export type ReminderOutcome<B> = {
  status: 200 | 400 | 401 | 403 | 429 | 500;
  body: B;
  /** Runs after the response (Next `after`). Never throws. */
  afterResponse?: () => Promise<void>;
};

/** The push for one reminder. The creditor's name goes into the dative: «Ты должен Айдосу 200 ₸». */
export function reminderPayload(t: ReminderTarget) {
  return { type: "reminder" as const, fromUserId: t.from_user, fromName: decline(t.from_name_dative, "dat"), amount: t.amount };
}

/** The push for a variable bill that still lacks its amount. `month` is the month's name: «ноябрь». */
export function billPayload(n: BillNotice) {
  const index = isMonthKey(n.month) ? Number(n.month.slice(5, 7)) - 1 : -1;
  return { type: "bill" as const, billId: n.bill_id, title: n.title, month: ru.months[index] ?? "" };
}

/** Sends to every device of the debtor; one dead or failing endpoint never stops the others, nothing is logged. */
async function sendAll(targets: ReminderTarget[], push: PushSender | null, notices: BillNotice[] = []): Promise<void> {
  if (!push) return;
  const jobs = [
    ...targets.flatMap((t) => t.subscriptions.map((sub) => ({ sub, payload: reminderPayload(t) }))),
    ...notices.flatMap((n) => n.subscriptions.map((sub) => ({ sub, payload: billPayload(n) }))),
  ];
  await Promise.all(
    jobs.map(async ({ sub, payload }) => {
      try {
        await push.send(sub, payload);
      } catch {
        // ignored on purpose
      }
    }),
  );
}

/** GET /api/cron/daily. 401 unless the bearer matches (constant time); an unset secret keeps it closed. */
export async function handleCron(
  authorization: string | null,
  deps: ReminderDeps | null,
): Promise<ReminderOutcome<{ ok: boolean; reminders?: number; bills?: number }>> {
  if (!deps || !bearerMatches(authorization, deps.secret)) return { status: 401, body: { ok: false } };
  let targets: ReminderTarget[];
  try {
    targets = await deps.repo.runDailyReminders(deps.secret);
  } catch {
    return { status: 500, body: { ok: false } };
  }
  // the monthly bills run after the reminders; a failure there must not undo (or hide) the reminders already logged
  let bills = { created: 0, notices: [] as BillNotice[] };
  let billsFailed = false;
  try {
    bills = await deps.repo.runMonthlyBills(deps.secret);
  } catch {
    billsFailed = true;
  }
  return {
    status: billsFailed ? 500 : 200,
    body: { ok: !billsFailed, reminders: targets.length, bills: bills.created },
    afterResponse: () => sendAll(targets, deps.push, bills.notices),
  };
}

/** POST /api/remind {household_id, debtor_id}: the session user (the repo's user) reminds one debtor. */
export async function handleRemind(
  raw: unknown,
  deps: ReminderDeps | null,
): Promise<ReminderOutcome<{ ok: boolean; retry_after?: number }>> {
  if (!deps) return { status: 500, body: { ok: false } };
  const body = remindBodySchema.safeParse(raw);
  if (!body.success) return { status: 400, body: { ok: false } };
  try {
    const target = await deps.repo.remind(deps.secret, body.data.household_id, body.data.debtor_id);
    return { status: 200, body: { ok: true }, afterResponse: () => sendAll([target], deps.push) };
  } catch (e) {
    if (e instanceof RepoError) {
      if (e.code === "unauthenticated") return { status: 401, body: { ok: false } };
      if (e.code === "forbidden" || e.code === "not_found") return { status: 403, body: { ok: false } };
      if (e.code === "invalid") return { status: 400, body: { ok: false } };
      if (e.code === "rate_limited") return { status: 429, body: { ok: false, retry_after: e.retryAfter } };
    }
    return { status: 500, body: { ok: false } };
  }
}

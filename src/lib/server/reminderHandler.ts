import { decline } from "@/lib/i18n/declension";
import { RepoError, type Repo } from "@/lib/data/repo";
import type { ReminderTarget } from "@/lib/data/types";
import { remindBodySchema } from "@/lib/domain/schemas";
import { bearerMatches } from "./cronAuth";
import type { PushSender } from "./push";

export type ReminderDeps = {
  repo: Pick<Repo, "remind" | "runDailyReminders">;
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

/** Sends to every device of the debtor; one dead or failing endpoint never stops the others, nothing is logged. */
async function sendAll(targets: ReminderTarget[], push: PushSender | null): Promise<void> {
  if (!push) return;
  await Promise.all(
    targets.flatMap((t) =>
      t.subscriptions.map(async (sub) => {
        try {
          await push.send(sub, reminderPayload(t));
        } catch {
          // ignored on purpose
        }
      }),
    ),
  );
}

/** GET /api/cron/daily. 401 unless the bearer matches (constant time); an unset secret keeps it closed. */
export async function handleCron(authorization: string | null, deps: ReminderDeps | null): Promise<ReminderOutcome<{ ok: boolean; reminders?: number }>> {
  if (!deps || !bearerMatches(authorization, deps.secret)) return { status: 401, body: { ok: false } };
  let targets: ReminderTarget[];
  try {
    targets = await deps.repo.runDailyReminders(deps.secret);
  } catch {
    return { status: 500, body: { ok: false } };
  }
  return { status: 200, body: { ok: true, reminders: targets.length }, afterResponse: () => sendAll(targets, deps.push) };
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

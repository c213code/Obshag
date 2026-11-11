import { decline } from "@/lib/i18n/declension";
import { formatTenge } from "@/lib/format/money";
import { RepoError, type Repo } from "@/lib/data/repo";
import type { PaidPromptNotice } from "@/lib/data/types";
import { paidOpenedBodySchema } from "@/lib/domain/schemas";
import type { PushSender } from "./push";
import type { InlineKeyboard, TelegramApi } from "./telegram/api";

/** How long the prompt waits before the bot asks (the database insists on at least 120 s). */
export const ASK_DELAY_MS = 150_000;
/** The route's maxDuration (seconds; the literal lives in app/api/settle/opened/route.ts): the delayed job runs inside `after()`, which the platform caps with it. */
export const ROUTE_MAX_DURATION_S = 170;

export type PaidDeps = {
  repo: Pick<Repo, "openPaidPrompt" | "paidPromptNotice">;
  /** null = push is not configured. */
  push: PushSender | null;
  /** null / missing = the bot is not configured (or mock mode): nothing goes to Telegram. */
  telegram?: TelegramApi | null;
  secret: string;
  /** Test seam: the wait before asking. Defaults to a real timer of ASK_DELAY_MS. */
  wait?: (ms: number) => Promise<void>;
};

/** What the delayed question needs: no session (the pay link has none), only the secret-gated notice. */
export type AskDeps = Omit<PaidDeps, "repo"> & { repo: Pick<Repo, "paidPromptNotice"> };

export type PaidOutcome = {
  status: 200 | 400 | 401 | 403 | 409 | 500;
  body: { ok: boolean };
  /** Runs after the response (Next `after`). Never throws. */
  afterResponse?: () => Promise<void>;
};

/** «Ты перевёл @aidos 200 ₸ через Kaspi?»: the tag is the @username when there is one, else the name. */
export const paidDmText = (n: Extract<PaidPromptNotice, { ask: true }>): string =>
  `Ты перевёл ${n.to_username ? `@${n.to_username}` : n.to_name} ${formatTenge(n.amount)} через Kaspi?`;

export const paidDmKeyboard = (promptId: string): InlineKeyboard => [
  [
    { text: "Да, перевёл", callback_data: `pp:y:${promptId}` },
    { text: "Ещё нет", callback_data: `pp:n:${promptId}` },
  ],
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The delayed question: Telegram DM when linked, else a push to every device. Every failure is swallowed. */
export async function askLater(promptId: string, deps: AskDeps): Promise<void> {
  try {
    await (deps.wait ?? sleep)(ASK_DELAY_MS);
    const n = await deps.repo.paidPromptNotice(deps.secret, promptId);
    if (!n.ask) return;
    if (n.telegram_user_id !== null && deps.telegram) {
      const sent = await deps.telegram.sendMessage(n.telegram_user_id, paidDmText(n), paidDmKeyboard(n.prompt_id)).catch(() => false);
      if (sent) return;
    }
    if (!deps.push) return;
    const payload = { type: "paid-ask" as const, toUserId: n.to_user, name: decline(n.to_name, "dat"), amount: n.amount };
    await Promise.all(
      n.subscriptions.map(async (sub) => {
        try {
          await deps.push!.send(sub, payload);
        } catch {
          // one failing device never stops the others
        }
      }),
    );
  } catch {
    // the question is best effort
  }
}

/** POST /api/settle/opened {household_id, to_user}: the signed-in debtor opened Kaspi. Records the prompt, asks later. */
export async function handlePaidOpened(raw: unknown, deps: PaidDeps | null): Promise<PaidOutcome> {
  if (!deps) return { status: 500, body: { ok: false } };
  const body = paidOpenedBodySchema.safeParse(raw);
  if (!body.success) return { status: 400, body: { ok: false } };
  try {
    const prompt = await deps.repo.openPaidPrompt(body.data.household_id, body.data.to_user);
    return { status: 200, body: { ok: true }, afterResponse: () => askLater(prompt.id, deps) };
  } catch (e) {
    if (e instanceof RepoError) {
      if (e.code === "unauthenticated") return { status: 401, body: { ok: false } };
      if (e.code === "forbidden" || e.code === "not_found") return { status: 403, body: { ok: false } };
      // too_small / nothing owed: not an error for the app, there is simply nothing to ask
      if (e.code === "too_small" || e.code === "invalid") return { status: 409, body: { ok: false } };
    }
    return { status: 500, body: { ok: false } };
  }
}

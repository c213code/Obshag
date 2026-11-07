import { parseAmount } from "@/lib/domain/parseAmount";
import { captureBodySchema } from "@/lib/domain/schemas";
import { RepoError, type Repo } from "@/lib/data/repo";
import type { PushSender } from "./push";

export type CaptureDeps = {
  repo: Pick<Repo, "capture" | "prunePushSubscription">;
  /** null = push is not configured: the capture still succeeds. */
  push: PushSender | null;
};

export type CaptureOutcome = {
  status: 201 | 400 | 401 | 429 | 500;
  body: { ok: boolean };
  /** Runs after the response was sent (Next `after`): push to every device, prune dead endpoints. Never throws. */
  afterResponse?: () => Promise<void>;
};

const fail = (status: 400 | 401 | 429 | 500): CaptureOutcome => ({ status, body: { ok: false } });

/**
 * The whole /api/capture decision, with no HTTP in it. It never logs and never echoes the token or the body:
 * every failure is a bare status.
 */
export async function handleCapture(raw: unknown, deps: CaptureDeps): Promise<CaptureOutcome> {
  const body = captureBodySchema.safeParse(raw);
  if (!body.success) return fail(400);
  const amount = parseAmount(body.data.amount);
  if (amount === null) return fail(400);
  const { token } = body.data;
  const merchant = body.data.merchant?.trim() || null;

  let captured;
  try {
    captured = await deps.repo.capture(token, amount, merchant);
  } catch (e) {
    if (e instanceof RepoError) {
      if (e.code === "unauthenticated") return fail(401);
      if (e.code === "rate_limited") return fail(429);
      if (e.code === "invalid") return fail(400);
    }
    return fail(500);
  }

  const { push, repo } = deps;
  if (!push || captured.subscriptions.length === 0) return { status: 201, body: { ok: true } };
  const payload = { type: "pending" as const, purchaseId: captured.purchase_id, merchant: captured.merchant, amount: captured.amount };
  return {
    status: 201,
    body: { ok: true },
    async afterResponse() {
      await Promise.all(
        captured.subscriptions.map(async (sub) => {
          try {
            const result = await push.send(sub, payload);
            if (!result.ok && result.gone) await repo.prunePushSubscription(token, sub.endpoint);
          } catch {
            // one bad endpoint must not stop the others, and nothing about it is logged
          }
        }),
      );
    },
  };
}

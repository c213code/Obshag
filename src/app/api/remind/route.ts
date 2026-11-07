import { after, NextResponse } from "next/server";
import { getRemindDeps } from "@/lib/server/reminderDeps";
import { handleRemind } from "@/lib/server/reminderHandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;

/** «Напомнить»: the signed-in creditor pushes a debtor (6h cooldown per pair). The body is never echoed. */
export async function POST(request: Request) {
  const text = await request.text().catch(() => null);
  const headers: Record<string, string> = { "cache-control": "no-store" };
  const reply = (status: number, body: object, extra: Record<string, string> = {}) =>
    NextResponse.json(body, { status, headers: { ...headers, ...extra } });
  if (text === null || text.length > MAX_BODY_BYTES) return reply(400, { ok: false });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return reply(400, { ok: false });
  }
  const deps = await getRemindDeps(request, headers).catch(() => null);
  const outcome = await handleRemind(json, deps);
  if (outcome.afterResponse) after(outcome.afterResponse);
  return reply(outcome.status, outcome.body, outcome.status === 429 && outcome.body.retry_after ? { "retry-after": String(outcome.body.retry_after) } : {});
}

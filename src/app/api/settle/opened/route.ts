import { after, NextResponse } from "next/server";
import { handlePaidOpened } from "@/lib/server/paidHandler";
import { getPaidDeps } from "@/lib/server/reminderDeps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** `after()` runs inside the route's duration: the ~150 s wait before the question needs more than the default (must be a literal; ROUTE_MAX_DURATION_S mirrors it). */
export const maxDuration = 170;

const MAX_BODY_BYTES = 1024;

/** «Открыть Kaspi»: records that the signed-in debtor went to pay, and asks «ты перевёл?» a couple of minutes later. The body is never echoed. */
export async function POST(request: Request) {
  const text = await request.text().catch(() => null);
  const headers: Record<string, string> = { "cache-control": "no-store" };
  const reply = (status: number, body: object) => NextResponse.json(body, { status, headers });
  if (text === null || text.length > MAX_BODY_BYTES) return reply(400, { ok: false });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return reply(400, { ok: false });
  }
  const deps = await getPaidDeps(request, headers).catch(() => null);
  const outcome = await handlePaidOpened(json, deps);
  if (outcome.afterResponse) after(outcome.afterResponse);
  return reply(outcome.status, outcome.body);
}

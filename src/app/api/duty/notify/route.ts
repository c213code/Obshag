import { after, NextResponse } from "next/server";
import { handleDutyNotify } from "@/lib/server/dutyHandler";
import { getDutyNotifyDeps } from "@/lib/server/reminderDeps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;

/** After a swap request or a decline: the signed-in user asks the server to push / DM the other side. The body is never echoed. */
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
  const deps = await getDutyNotifyDeps(request, headers).catch(() => null);
  const outcome = await handleDutyNotify(json, deps);
  if (outcome.afterResponse) after(outcome.afterResponse);
  return reply(outcome.status, outcome.body);
}

import { after, NextResponse } from "next/server";
import { handlePayLinkOpen } from "@/lib/server/payLinkHandler";
import { getPayLinkDeps } from "@/lib/server/reminderDeps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** `after()` runs inside the route's duration: the ~150 s wait before the bot asks needs more than the default (must be a literal; same as /api/settle/opened). */
export const maxDuration = 170;

/** «Скопировать номер и открыть Kaspi» on /k/<code>: records the prompt of the link's pair, asks «ты перевёл?» later. No body is read. */
export async function POST(_request: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const outcome = await handlePayLinkOpen(code, getPayLinkDeps());
  if (outcome.afterResponse) after(outcome.afterResponse);
  return NextResponse.json(outcome.body, { status: outcome.status, headers: { "cache-control": "no-store" } });
}

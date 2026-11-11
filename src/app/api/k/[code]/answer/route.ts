import { NextResponse } from "next/server";
import { handlePayLinkAnswer } from "@/lib/server/payLinkHandler";
import { getPayLinkDeps } from "@/lib/server/reminderDeps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;

/** «Да, перевёл» / «Ещё нет» on /k/<code>. The prompt must belong to the link's pair; the body is never echoed. */
export async function POST(request: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const headers = { "cache-control": "no-store" };
  const text = await request.text().catch(() => null);
  if (text === null || text.length > MAX_BODY_BYTES) return NextResponse.json({ result: "error" }, { status: 400, headers });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ result: "error" }, { status: 400, headers });
  }
  const outcome = await handlePayLinkAnswer(code, json, getPayLinkDeps());
  return NextResponse.json(outcome.body, { status: outcome.status, headers });
}

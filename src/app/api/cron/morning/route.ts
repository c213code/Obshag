import { after, NextResponse } from "next/server";
import { handleMorning } from "@/lib/server/dutyHandler";
import { getMorningDeps } from "@/lib/server/reminderDeps";

// Vercel Cron (vercel.json): 09:00 Asia/Almaty = 04:00 UTC. Node runtime for web-push; never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** «Сегодня готовишь ты» push plus the group post. Vercel sends `Authorization: Bearer ${CRON_SECRET}`; anything else gets a bare 401. */
export async function GET(request: Request) {
  const outcome = await handleMorning(request.headers.get("authorization"), getMorningDeps());
  if (outcome.afterResponse) after(outcome.afterResponse);
  return NextResponse.json(outcome.body, { status: outcome.status, headers: { "cache-control": "no-store" } });
}

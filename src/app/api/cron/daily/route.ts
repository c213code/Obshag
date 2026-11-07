import { after, NextResponse } from "next/server";
import { getCronDeps } from "@/lib/server/reminderDeps";
import { handleCron } from "@/lib/server/reminderHandler";

// Vercel Cron (vercel.json). Node runtime for web-push; never cached or prerendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Daily 19:00 Asia/Almaty reminders. Vercel sends `Authorization: Bearer ${CRON_SECRET}`; anything else gets a bare 401. */
export async function GET(request: Request) {
  const outcome = await handleCron(request.headers.get("authorization"), getCronDeps());
  if (outcome.afterResponse) after(outcome.afterResponse);
  return NextResponse.json(outcome.body, { status: outcome.status, headers: { "cache-control": "no-store" } });
}

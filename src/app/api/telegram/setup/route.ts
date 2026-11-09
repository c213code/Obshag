import { NextResponse } from "next/server";
import { bearerMatches, readCronSecret } from "@/lib/server/cronAuth";
import { getTelegramApi, readWebhookSecret } from "@/lib/server/telegram/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One-off: registers /api/telegram/webhook with Telegram. Bearer CRON_SECRET. Returns a bare `{ok}`. */
export async function POST(request: Request) {
  const reply = (status: number, ok: boolean) => NextResponse.json({ ok }, { status, headers: { "cache-control": "no-store" } });
  if (!bearerMatches(request.headers.get("authorization"), readCronSecret())) return reply(401, false);
  const api = getTelegramApi();
  const secret = readWebhookSecret();
  if (!api || !secret) return reply(500, false);
  const ok = await api.setWebhook(`${new URL(request.url).origin}/api/telegram/webhook`, secret);
  return reply(ok ? 200 : 502, ok);
}

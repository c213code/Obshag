import { NextResponse } from "next/server";
import { getWebhookDeps } from "@/lib/server/telegram/deps";
import { handleWebhook, SECRET_HEADER, webhookAuthorized } from "@/lib/server/telegram/webhookHandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Telegram bot webhook: /start <code> links the chat, the Общее / Моё buttons resolve a pending purchase. */
export async function POST(request: Request) {
  const reply = (status: number, body: object) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
  const deps = getWebhookDeps();
  const given = request.headers.get(SECRET_HEADER);
  // refuse before reading the body when the secret is wrong
  if (!webhookAuthorized(given, deps)) return reply(401, { ok: false });
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 64 * 1024) return reply(200, { ok: true });
  const body = await request.text().catch(() => "");
  const outcome = await handleWebhook(given, body, deps);
  return reply(outcome.status, outcome.body);
}

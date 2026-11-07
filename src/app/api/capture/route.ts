import { after, NextResponse } from "next/server";
import { getCaptureDeps } from "@/lib/server/captureDeps";
import { handleCapture } from "@/lib/server/captureHandler";

// Node runtime: web-push needs it. Never cached, never prerendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;

const reply = (status: number, ok: boolean) => NextResponse.json({ ok }, { status, headers: { "cache-control": "no-store" } });

/**
 * Called by the iOS Shortcut after an Apple Pay payment. No cookie, no service-role key: the token is the credential and
 * the database RPC checks its hash. The token and the body are never logged and never echoed back.
 */
export async function POST(request: Request) {
  const deps = getCaptureDeps();
  if (!deps) return reply(500, false);

  const text = await request.text().catch(() => null);
  if (text === null || text.length > MAX_BODY_BYTES) return reply(400, false);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return reply(400, false);
  }

  const outcome = await handleCapture(json, deps);
  if (outcome.afterResponse) after(outcome.afterResponse);
  return reply(outcome.status, outcome.body.ok);
}

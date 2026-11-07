import { NextResponse } from "next/server";
import { mockStoreEnabled as enabled } from "@/lib/data/mockStoreGate";
import { MOCK_SCHEMA_VERSION, parseStored } from "@/lib/data/mockDb";
import { readServerStore, writeServerStore } from "@/lib/data/mockServerStore";

/**
 * TEST ONLY. In an E2E build (mock mode + NEXT_PUBLIC_E2E=1) this route holds the mock database in server
 * memory, so two browser contexts can share households and purchases like two phones would.
 * It also needs the server-side opt-in E2E_ALLOW_MOCK_STORE=1 and refuses to run when a Supabase URL is
 * configured. In any other setup it does not exist (404).
 *
 * Writes are compare-and-set on a revision: a PUT carries the revision it was based on, and a stale one gets 409.
 */
const MAX_BYTES = 2_000_000;


export async function GET() {
  if (!enabled()) return new NextResponse(null, { status: 404 });
  const current = readServerStore();
  return NextResponse.json(
    { stored: current ? { version: MOCK_SCHEMA_VERSION, rev: current.rev, db: current.db } : null },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  if (!enabled()) return new NextResponse(null, { status: 404 });
  const text = await request.text();
  if (text.length > MAX_BYTES) return new NextResponse(null, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const body = parseStored(json);
  if (!body) return new NextResponse(null, { status: 400 });
  // body.rev is the revision the client based this write on
  if (!writeServerStore(body.db, body.rev)) return new NextResponse(null, { status: 409 });
  return new NextResponse(null, { status: 204 });
}

import { NextResponse } from "next/server";
import { mockStoreEnabled } from "@/lib/data/mockStoreGate";
import { pushLog } from "@/lib/server/captureDeps";

/** TEST ONLY (same gate as /api/mock-store): what the recording push sender received. 404 everywhere else. */
export async function GET() {
  if (!mockStoreEnabled()) return new NextResponse(null, { status: 404 });
  return NextResponse.json({ calls: pushLog() }, { headers: { "cache-control": "no-store" } });
}

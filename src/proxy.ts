import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env/public";
import { updateSession } from "@/lib/supabase/proxy";

/** Session refresh + anonymous redirect. Mock mode has no server session, so it passes through. */
export async function proxy(request: NextRequest) {
  // A malformed %-escape (/join/%E0%A4%A) would make Next's own route matching answer with a bare 500: say 400 instead.
  try {
    decodeURIComponent(request.nextUrl.pathname);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const env = getPublicEnv();
  if (env.NEXT_PUBLIC_DATA_MODE === "mock" || !env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next();
  }
  return updateSession(request, env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

// Everything except Next internals, public assets, the gallery /api/capture (the iOS Shortcut has no cookie: the token is its credential) /api/cron (Vercel Cron: the bearer CRON_SECRET) and /api/telegram (Telegram has no cookie: the webhook secret header, or the bearer CRON_SECRET for setup). Exclusions are anchored (`kit(?:/|$)`), so a
// real route such as /kitchen is still protected, and static files are matched by extension.
export const config = {
  matcher: [
    "/((?!_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$|manifest\\.webmanifest$|sw\\.js$|sw-rules\\.js$|offline(?:/|$)|icons(?:/|$)|api/mock-store(?:/|$)|api/mock-push-log(?:/|$)|api/capture(?:/|$)|api/cron(?:/|$)|api/telegram(?:/|$)|kit(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|json|webmanifest)$).*)",
  ],
};

import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/env/public";

/** Server client for Server Components, Route Handlers and Server Actions (RLS applies as the signed-in user). */
export async function createSupabaseServerClient(
  opts: { /** Route Handlers pass this to copy the cache headers onto their own NextResponse. */ onCacheHeaders?: (headers: Record<string, string>) => void } = {},
): Promise<SupabaseClient> {
  const env = getPublicEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  const store = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      // The cache headers (second argument) must reach the response that carries Set-Cookie, otherwise a CDN could
      // cache it. Route Handlers get them through `onCacheHeaders`; Server Components cannot set cookies at all, and
      // the proxy (src/proxy.ts) applies them to every response that refreshes the session.
      setAll(list, headers) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
          if (headers) opts.onCacheHeaders?.(headers);
        } catch {
          // called from a Server Component: the proxy refreshes the session instead
        }
      },
    },
  });
}

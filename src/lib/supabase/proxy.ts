import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Paths an anonymous visitor may open (everything else redirects to /login). */
const PUBLIC_PREFIXES = ["/login", "/join", "/forgot", "/reset", "/offline"];

export const isPublicPath = (pathname: string) =>
  PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

type CookieList = Array<{ name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] }>;

/** The cache-control headers @supabase/ssr hands to setAll(cookies, headers) next to a refreshed session. */
export function applyCacheHeaders(target: NextResponse, headers: Record<string, string> | undefined) {
  for (const [key, value] of Object.entries(headers ?? {})) target.headers.set(key, value);
}

type Deps = { createClient?: typeof createServerClient };

/**
 * Refreshes the Supabase session cookie on every request and sends anonymous visitors to /login.
 * The client-side guard (components/app/Guard) handles the finer onboarding stages.
 *
 * A response that carries Set-Cookie must never be cached by a CDN, so the cache headers from setAll are copied
 * onto the normal response AND onto the redirect.
 */
export async function updateSession(
  request: NextRequest,
  url: string,
  anonKey: string,
  { createClient = createServerClient }: Deps = {},
): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  let cacheHeaders: Record<string, string> = {};
  const supabase = createClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list: CookieList, headers?: Record<string, string>) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        cacheHeaders = { ...cacheHeaders, ...headers };
        applyCacheHeaders(response, cacheHeaders);
      },
    },
  });

  let signedIn: boolean;
  try {
    // getClaims validates the JWT signature (do not trust getSession() on the server)
    const { data } = await supabase.auth.getClaims();
    signedIn = !!data?.claims;
  } catch {
    // Supabase unreachable: let the request through. The page's own guard and RLS still protect the data,
    // and an outage must not turn every page into a 500.
    return response;
  }
  if (!signedIn && !isPublicPath(request.nextUrl.pathname)) {
    const redirect = NextResponse.redirect(new URL("/login", request.url));
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    applyCacheHeaders(redirect, cacheHeaders);
    return redirect;
  }
  return response;
}

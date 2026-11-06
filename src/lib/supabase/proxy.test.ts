import type { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { isPublicPath, updateSession } from "./proxy";

describe("isPublicPath", () => {
  it("lets anonymous visitors reach login and join links only", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/login/verify")).toBe(true);
    expect(isPublicPath("/join/ABC")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/purchases/new")).toBe(false);
    expect(isPublicPath("/loginx")).toBe(false);
  });
});

const CACHE = { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0", Pragma: "no-cache" };

/** A fake @supabase/ssr client: getClaims optionally refreshes the session (calling setAll with cookies + headers). */
function fakeFactory(opts: { claims: boolean; refresh?: boolean; throws?: boolean }): typeof createServerClient {
  return ((_url: string, _key: string, o: { cookies: { setAll: (c: unknown[], h?: Record<string, string>) => void } }) => ({
    auth: {
      getClaims: async () => {
        if (opts.throws) throw new Error("fetch failed");
        if (opts.refresh) o.cookies.setAll([{ name: "sb-token", value: "fresh", options: { path: "/" } }], CACHE);
        return { data: opts.claims ? { claims: { sub: "u1" } } : null };
      },
    },
  })) as unknown as typeof createServerClient;
}

const req = (path: string) => new NextRequest(`http://localhost:3000${path}`);

describe("updateSession", () => {
  it("copies the cache headers onto a normal response that refreshed the session", async () => {
    const res = await updateSession(req("/"), "https://x.supabase.co", "k", { createClient: fakeFactory({ claims: true, refresh: true }) });
    expect(res.headers.get("cache-control")).toBe(CACHE["Cache-Control"]);
    expect(res.headers.get("pragma")).toBe("no-cache");
    expect(res.cookies.get("sb-token")?.value).toBe("fresh");
    expect(res.headers.get("location")).toBeNull();
  });

  it("copies cookies AND cache headers onto the redirect for an anonymous visitor", async () => {
    const res = await updateSession(req("/purchases/new"), "https://x.supabase.co", "k", { createClient: fakeFactory({ claims: false, refresh: true }) });
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(res.headers.get("cache-control")).toBe(CACHE["Cache-Control"]);
    expect(res.cookies.get("sb-token")?.value).toBe("fresh");
  });

  it("lets anonymous visitors through on public paths", async () => {
    const res = await updateSession(req("/login"), "https://x.supabase.co", "k", { createClient: fakeFactory({ claims: false }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not turn a Supabase outage into a 500: getClaims throwing passes the request through", async () => {
    const res = await updateSession(req("/"), "https://x.supabase.co", "k", { createClient: fakeFactory({ claims: false, throws: true }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

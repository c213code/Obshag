import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type Req = { url: string; method?: string; mode?: string; headers?: Record<string, string> };
type Rules = {
  strategyFor(r: Req, origin: string): string;
  shouldCache(r: Req, origin: string, res: unknown): boolean;
};

const sandbox: { self: Record<string, unknown>; URL: typeof URL; Object: typeof Object; String: typeof String } = { self: {}, URL, Object, String };
vm.runInNewContext(readFileSync(join(process.cwd(), "public/sw-rules.js"), "utf8"), sandbox);
const rules = sandbox.self.swRules as Rules;

const O = "https://obshak.test";
const get = (path: string, extra: Partial<Req> = {}): Req => ({ url: O + path, method: "GET", headers: {}, ...extra });
const res = (init: { status?: number; type?: string; redirected?: boolean; headers?: Record<string, string> } = {}) => ({
  status: init.status ?? 200,
  type: init.type ?? "basic",
  redirected: init.redirected ?? false,
  headers: { get: (k: string) => init.headers?.[k.toLowerCase()] ?? null },
});

describe("service worker fetch rules", () => {
  it("immutable static assets are cache-first", () => {
    for (const path of ["/_next/static/chunks/a.js", "/icons/icon-192.png", "/fonts/x.woff2", "/manifest.webmanifest"]) {
      expect(rules.strategyFor(get(path), O)).toBe("cache-first");
    }
  });

  it("navigations are network-first", () => {
    expect(rules.strategyFor(get("/flat", { mode: "navigate" }), O)).toBe("network-first");
  });

  it("NEVER touches: /api/*", () => {
    expect(rules.strategyFor(get("/api/capture"), O)).toBe("bypass");
    expect(rules.strategyFor(get("/api/anything", { mode: "navigate" }), O)).toBe("bypass");
    expect(rules.shouldCache(get("/api/_next/static/x.js"), O, res())).toBe(false);
  });

  it("NEVER touches: a request with an Authorization header", () => {
    expect(rules.strategyFor(get("/_next/static/a.js", { headers: { Authorization: "Bearer x" } }), O)).toBe("bypass");
  });

  it("NEVER touches: cross-origin requests (Supabase, kaspi.kz)", () => {
    expect(rules.strategyFor({ url: "https://abc.supabase.co/rest/v1/purchases", method: "GET" }, O)).toBe("bypass");
    expect(rules.strategyFor({ url: "https://kaspi.kz/transfers", method: "GET", mode: "navigate" }, O)).toBe("bypass");
    expect(rules.strategyFor({ url: "https://cdn.test/_next/static/a.js", method: "GET" }, O)).toBe("bypass");
    expect(rules.shouldCache({ url: "https://cdn.test/_next/static/a.js", method: "GET" }, O, res())).toBe(false);
  });

  it("NEVER touches: RSC payloads (?_rsc= and the RSC header)", () => {
    expect(rules.strategyFor(get("/flat?_rsc=abc", { mode: "navigate" }), O)).toBe("bypass");
    expect(rules.strategyFor(get("/flat", { headers: { RSC: "1" }, mode: "navigate" }), O)).toBe("bypass");
    expect(rules.shouldCache(get("/_next/static/a.js?_rsc=1"), O, res())).toBe(false);
  });

  it("NEVER touches: non-GET requests", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
      expect(rules.strategyFor(get("/_next/static/a.js", { method }), O)).toBe("bypass");
      expect(rules.shouldCache(get("/_next/static/a.js", { method }), O, res())).toBe(false);
    }
  });

  it("NEVER stores: no-store or private responses, errors, redirects, opaque", () => {
    const r = get("/_next/static/a.js");
    expect(rules.shouldCache(r, O, res())).toBe(true);
    expect(rules.shouldCache(r, O, res({ headers: { "cache-control": "no-store" } }))).toBe(false);
    expect(rules.shouldCache(r, O, res({ headers: { "cache-control": "private, max-age=0" } }))).toBe(false);
    expect(rules.shouldCache(r, O, res({ headers: { vary: "*" } }))).toBe(false);
    expect(rules.shouldCache(r, O, res({ status: 404 }))).toBe(false);
    expect(rules.shouldCache(r, O, res({ status: 206 }))).toBe(false);
    expect(rules.shouldCache(r, O, res({ redirected: true }))).toBe(false);
    expect(rules.shouldCache(r, O, res({ type: "opaque" }))).toBe(false);
  });

  it("never stores HTML pages, whatever the headers", () => {
    expect(rules.shouldCache(get("/", { mode: "navigate" }), O, res())).toBe(false);
    expect(rules.shouldCache(get("/flat"), O, res())).toBe(false);
  });

  it("ignores junk", () => {
    expect(rules.strategyFor({ url: "not a url", method: "GET" }, O)).toBe("bypass");
    expect(rules.strategyFor({} as Req, O)).toBe("bypass");
  });
});

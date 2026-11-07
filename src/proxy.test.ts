import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

// Next compiles the matcher as path-to-regexp-ish source with an implicit ^...$ anchor
const re = new RegExp(`^${config.matcher[0]}$`);
const matched = (path: string) => re.test(path);

describe("proxy matcher", () => {
  it("runs on app pages", () => {
    for (const p of ["/", "/login", "/purchases/new", "/flat", "/join/ABC123", "/kitchen", "/icons-gallery", "/api/other", "/api/capture-evil"]) {
      expect(matched(p), p).toBe(true);
    }
  });
  it("skips internals, the gallery and the mock store (anchored)", () => {
    for (const p of ["/_next/static/chunks/a.js", "/_next/image", "/kit", "/kit/x", "/api/mock-store", "/api/capture", "/icons/a.png", "/sw.js", "/favicon.ico"]) {
      expect(matched(p), p).toBe(false);
    }
  });
  it("skips static files by extension, but not routes that merely contain a dot-less name", () => {
    for (const p of ["/logo.svg", "/a/b.PNG".toLowerCase(), "/robots.txt", "/data.json", "/app.webmanifest", "/x.webp"]) {
      expect(matched(p), p).toBe(false);
    }
    expect(matched("/svg")).toBe(true);
  });
});

describe("proxy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("answers a malformed %-escape with 400 instead of letting routing crash", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "mock");
    vi.stubEnv("NEXT_PUBLIC_E2E", "1");
    const res = await proxy(new NextRequest("http://localhost:3000/join/%E0%A4%A"));
    expect(res.status).toBe(400);
  });

  it("passes normal requests through in mock mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "mock");
    vi.stubEnv("NEXT_PUBLIC_E2E", "1");
    const res = await proxy(new NextRequest("http://localhost:3000/join/ABC%20D"));
    expect(res.status).toBe(200);
  });
});

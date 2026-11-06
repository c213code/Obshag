import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_SCHEMA_VERSION, MockConflictError } from "./mockDb";
import { localStorageSession, localStorageStorage, serverStorage } from "./mockBrowser";
import { createSeed } from "./seed";

function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const DB_KEY = `obshak.mock.db.v${MOCK_SCHEMA_VERSION}`;

afterEach(() => vi.unstubAllGlobals());

describe("mockBrowser storages", () => {
  it("falls back to memory without a window (server render)", async () => {
    const storage = localStorageStorage();
    expect(await storage.load()).toBeNull();
    await storage.save(createSeed(), 0);
    expect((await storage.load())?.db.households).toHaveLength(1);
    const session = localStorageSession();
    session.set("u1");
    expect(session.get()).toBe("u1");
  });

  it("persists the db and the session in localStorage, and survives corruption", async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: ls });
    const storage = localStorageStorage();
    expect(await storage.load()).toBeNull();
    await storage.save(createSeed(), 0);
    expect((await localStorageStorage().load())?.db.users[0].email).toBe("erasyl@obshak.test");
    ls.setItem(DB_KEY, "{not json");
    expect(await storage.load()).toBeNull();

    const session = localStorageSession();
    expect(session.get()).toBeNull();
    session.set("u1");
    expect(localStorageSession().get()).toBe("u1");
    session.set(null);
    expect(session.get()).toBeNull();
  });

  it("stores {version, rev, db}, validates it, and reseeds on a version or shape mismatch", async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: ls });
    const storage = localStorageStorage();
    await storage.save(createSeed(), 0);
    const saved = JSON.parse(ls.getItem(DB_KEY)!) as { version: number; rev: number; db: unknown };
    expect(saved).toMatchObject({ version: MOCK_SCHEMA_VERSION, rev: 1 });
    // revisions advance and a stale writer is refused
    await storage.save(createSeed(), 1);
    expect((await storage.load())?.rev).toBe(2);
    await expect(storage.save(createSeed(), 1)).rejects.toBeInstanceOf(MockConflictError);
    // an older shape or a broken table is discarded
    ls.setItem(DB_KEY, JSON.stringify({ ...saved, version: MOCK_SCHEMA_VERSION - 1 }));
    expect(await storage.load()).toBeNull();
    ls.setItem(DB_KEY, JSON.stringify({ ...saved, db: { ...(saved.db as object), members: "nope" } }));
    expect(await storage.load()).toBeNull();
  });

  it("survives a blocked localStorage (getItem/setItem throw)", async () => {
    const boom = () => {
      throw new Error("SecurityError");
    };
    vi.stubGlobal("window", { localStorage: { getItem: boom, setItem: boom, removeItem: boom } });
    const storage = localStorageStorage();
    expect(await storage.load()).toBeNull();
    await expect(storage.save(createSeed(), 0)).resolves.toBeUndefined();
    const session = localStorageSession();
    expect(session.get()).toBeNull();
    expect(() => session.set("u1")).not.toThrow();
    expect(() => session.set(null)).not.toThrow();
    // accessing window.localStorage itself throws
    vi.stubGlobal("window", {
      get localStorage(): never {
        throw new Error("SecurityError");
      },
    });
    expect(await localStorageStorage().load()).toBeNull();
  });

  it("serverStorage talks to the store route and reports failures", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        calls.push({ url, method: init?.method ?? "GET" });
        if (init?.method === "PUT") return { ok: true, status: 204 };
        return { ok: true, status: 200, json: async () => ({ stored: { version: MOCK_SCHEMA_VERSION, rev: 3, db: createSeed() } }) };
      }),
    );
    const storage = serverStorage("/api/x");
    expect((await storage.load())?.db.households).toHaveLength(1);
    await storage.save(createSeed(), 3);
    expect(calls).toEqual([
      { url: "/api/x", method: "GET" },
      { url: "/api/x", method: "PUT" },
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(storage.load()).rejects.toThrow(/unavailable/);
    await expect(storage.save(createSeed(), 3)).rejects.toThrow(/failed/);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 409 })));
    await expect(storage.save(createSeed(), 3)).rejects.toBeInstanceOf(MockConflictError);
  });
});

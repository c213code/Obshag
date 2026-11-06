import { MOCK_SCHEMA_VERSION, MockConflictError, parseStored, type MockStorage } from "./mockDb";
import { memorySession, memoryStorage, type SessionStore } from "./mockRepo";

const DB_KEY = `obshak.mock.db.v${MOCK_SCHEMA_VERSION}`;
const SESSION_KEY = "obshak.mock.session.v1";

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? (window.localStorage ?? null) : null;
  } catch {
    return null; // blocked (private mode, disabled storage)
  }
}

/**
 * Mock database in localStorage: a reload keeps the state. Data that fails validation (corrupt, or saved by an
 * older shape) is ignored and reseeded. Falls back to memory when localStorage is missing or blocked.
 */
export function localStorageStorage(): MockStorage {
  const ls = safeStorage();
  if (!ls) return memoryStorage();
  return {
    async load() {
      try {
        const raw = ls.getItem(DB_KEY);
        return raw ? parseStored(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    async save(db, baseRev) {
      let current = 0;
      try {
        const raw = ls.getItem(DB_KEY);
        current = (raw ? parseStored(JSON.parse(raw)) : null)?.rev ?? 0;
      } catch {
        current = 0;
      }
      if (current !== baseRev) throw new MockConflictError(); // another tab saved in between
      try {
        ls.setItem(DB_KEY, JSON.stringify({ version: MOCK_SCHEMA_VERSION, rev: baseRev + 1, db }));
      } catch {
        // quota or blocked: the app keeps working for this call, the next load reseeds
      }
    },
  };
}

/** The signed-in mock user, per device (localStorage is per browser context). */
export function localStorageSession(): SessionStore {
  const ls = safeStorage();
  if (!ls) return memorySession();
  return {
    get: () => {
      try {
        return ls.getItem(SESSION_KEY);
      } catch {
        return null;
      }
    },
    set: (id) => {
      try {
        if (id) ls.setItem(SESSION_KEY, id);
        else ls.removeItem(SESSION_KEY);
      } catch {
        // blocked storage: the session simply does not persist
      }
    },
  };
}

/**
 * E2E only (NEXT_PUBLIC_E2E=1): one mock database held by the server route /api/mock-store,
 * so two browser contexts can see each other's households and purchases.
 */
export function serverStorage(url = "/api/mock-store"): MockStorage {
  return {
    async load() {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`mock store unavailable (${res.status})`);
      const body = (await res.json()) as { stored: unknown };
      return parseStored(body.stored);
    },
    async save(db, baseRev) {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: MOCK_SCHEMA_VERSION, rev: baseRev, db }),
      });
      if (res.status === 409) throw new MockConflictError();
      if (!res.ok) throw new Error(`mock store write failed (${res.status})`);
    },
  };
}

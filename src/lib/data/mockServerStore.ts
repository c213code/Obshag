import { MOCK_SCHEMA_VERSION, MockConflictError, type MockStorage, type StoredMock } from "./mockDb";

/** E2E only: the mock database held in server memory (shared by /api/mock-store and /api/capture). */
const holder = globalThis as typeof globalThis & { __obshakMockDb?: StoredMock | null };

export const readServerStore = (): StoredMock | null => holder.__obshakMockDb ?? null;

/** Compare-and-set write: succeeds only when the stored revision is still `baseRev`. */
export function writeServerStore(db: StoredMock["db"], baseRev: number): boolean {
  if ((holder.__obshakMockDb?.rev ?? 0) !== baseRev) return false;
  holder.__obshakMockDb = { rev: baseRev + 1, db };
  return true;
}

/** A MockStorage over the server memory, for server-side code that acts on the same database as the browsers. */
export function serverStoreStorage(): MockStorage {
  return {
    async load() {
      const current = readServerStore();
      return current ? { rev: current.rev, db: structuredClone(current.db) } : null;
    },
    async save(db, baseRev) {
      if (!writeServerStore(structuredClone(db), baseRev)) throw new MockConflictError();
    },
  };
}

export { MOCK_SCHEMA_VERSION };

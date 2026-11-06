import { getPublicEnv } from "@/lib/env/public";

/** Whether the E2E-only /api/mock-store route may serve requests (see the route for the full story). */
export const mockStoreEnabled = (env: Record<string, string | undefined> = process.env) => {
  try {
    if (env.E2E_ALLOW_MOCK_STORE !== "1") return false;
    if (env.NEXT_PUBLIC_SUPABASE_URL) return false;
    const pub = getPublicEnv();
    return pub.NEXT_PUBLIC_DATA_MODE === "mock" && pub.NEXT_PUBLIC_E2E === "1";
  } catch {
    return false;
  }
};

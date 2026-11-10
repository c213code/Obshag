import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  // the service worker is blocked by default: a registered worker hides requests from page.route (slice 4 opts in where it tests it)
  use: { baseURL: `http://localhost:${PORT}`, ...devices["iPhone 15"], serviceWorkers: "block", colorScheme: "dark" },
  projects: [{ name: "webkit-iphone15", use: { ...devices["iPhone 15"] } }],
  // Production build, so tests see real behaviour (CSP, no dev overlay, no HMR).
  // NEXT_PUBLIC_* are inlined at build time, hence the env applies to `build` as well as `start`.
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/kit`,
    reuseExistingServer: false,
    timeout: 300_000,
    // The developer's .env.local may point at a live Supabase project: process env wins over it, so blank those out.
    env: {
      NEXT_PUBLIC_DATA_MODE: "mock",
      NEXT_PUBLIC_E2E: "1",
      E2E_ALLOW_MOCK_STORE: "1",
      // the bearer of /api/cron/daily and the server secret of /api/remind in the E2E mock backend
      CRON_SECRET: "e2e-cron-secret-0123456789abcdef",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    },
  },
});

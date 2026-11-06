import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, ...devices["iPhone 15"] },
  projects: [{ name: "webkit-iphone15", use: { ...devices["iPhone 15"] } }],
  // Production build, so tests see real behaviour (CSP, no dev overlay, no HMR).
  // NEXT_PUBLIC_* are inlined at build time, hence the env applies to `build` as well as `start`.
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/kit`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: { NEXT_PUBLIC_DATA_MODE: "mock", NEXT_PUBLIC_E2E: "1" },
  },
});

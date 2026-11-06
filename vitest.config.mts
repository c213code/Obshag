import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/db/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: [
        "src/lib/**/*.test.ts",
        "src/lib/data/types.ts",
        "src/lib/data/repo.ts",
        "src/lib/i18n/**",
        "src/lib/motion/**",
      ],
      thresholds: { lines: 80 },
    },
  },
});

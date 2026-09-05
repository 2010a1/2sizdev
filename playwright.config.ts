import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: true,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  expect: { timeout: 10_000 },
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: [
    {
      // The app now requires an account (ProfileGate), so e2e needs a real API.
      // Isolated SQLite file keeps e2e state out of ./data.
      command: "pnpm --filter @exam/api start",
      url: "http://127.0.0.1:3000/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        DATABASE_URL: "file:./e2e-data/e2e.db",
        STORAGE_DRIVER: "sqlite",
        NODE_ENV: "test",
        // Seeds the admin account on first boot of a fresh e2e DB (skipped
        // when one already exists), so notification admin flows are testable.
        ADMIN_INITIAL_USERNAME: "admin",
        ADMIN_INITIAL_PASSWORD: "e2e-admin-password-123",
        // Browsers still send an Origin header on POST through the preview
        // proxy, so the API's CORS allowlist must include the preview origin.
        CORS_ORIGINS: "http://127.0.0.1:4173,http://localhost:5173",
        // The suite registers a fresh user per test from one IP; the production
        // register limit (5/min/IP) would 429 the back half of the run.
        REGISTER_RATE_LIMIT_PER_MINUTE: "60"
      }
    },
    {
      command: "pnpm --filter @exam/web build && pnpm --filter @exam/web start -- --host 127.0.0.1",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    }
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});

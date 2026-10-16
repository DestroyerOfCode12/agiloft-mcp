import { defineConfig, devices } from '@playwright/test';

const PORT = 8181;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /responsive\.spec\.ts/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
      testMatch: /responsive\.spec\.ts/,
    },
  ],
  webServer: {
    command: `rm -rf .data/e2e && node apps/api/dist/main.js`,
    url: `http://localhost:${PORT}/readyz`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      PUBLIC_BASE_URL: `http://localhost:${PORT}`,
      DATABASE_URL: 'pglite:.data/e2e',
      AUTH_MODE: 'dev',
      DEMO_MODE: 'true',
      LOG_LEVEL: 'warn',
      WORKER_POLL_MS: '300',
      CONSOLE_DIST: 'apps/console/dist',
    },
  },
});

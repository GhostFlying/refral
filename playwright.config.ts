import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/chrome',
  outputDir: 'artifacts/playwright',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: 'artifacts/chrome-results.json' }]],
  use: {
    channel: 'chrome',
    headless: process.env.REFRAL_HEADLESS !== '0',
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1000, height: 760 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'REFRAL_TEST=1 pnpm dev',
    url: 'http://127.0.0.1:4173/examples/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});

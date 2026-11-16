import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../playwright.config';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('../artifacts/dom-input/pr4/performance/', import.meta.url));

export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL('./', import.meta.url)),
  testMatch: 'dom-upload.spec.ts',
  outputDir: fileURLToPath(new URL('../artifacts/dom-input/pr4/performance/playwright/', import.meta.url)),
  timeout: 600_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  use: { ...base.use, headless: true },
  reporter: [['list'], ['json', { outputFile: output + 'tests.json' }]],
  webServer: {
    command: 'REFRAL_TEST=1 REFRAL_BENCHMARK=1 pnpm dev',
    cwd: root,
    url: 'http://127.0.0.1:4173/examples/index.html',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

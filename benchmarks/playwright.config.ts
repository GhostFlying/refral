import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../playwright.config';

const root = fileURLToPath(new URL('../', import.meta.url));
export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL('../tests/performance', import.meta.url)),
  outputDir: fileURLToPath(new URL('../artifacts/benchmarks/playwright', import.meta.url)),
  timeout: 1_800_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'artifacts/benchmarks/chrome-results.json' }]],
  webServer: { command: 'REFRAL_TEST=1 REFRAL_BENCHMARK=1 pnpm dev', cwd: root,
    url: 'http://127.0.0.1:4173/examples/index.html', reuseExistingServer: false, timeout: 30_000 },
});

import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../playwright.config';

export default defineConfig({
  ...base,
  testDir: '../tests/performance',
  testMatch: 'readpixels-benchmark.spec.ts',
  outputDir: '../artifacts/readpixels/performance-playwright',
  timeout: 600_000,
  reporter: [['list'], ['json', {
    outputFile: fileURLToPath(new URL('../artifacts/readpixels/performance-tests.json', import.meta.url)),
  }]],
  webServer: { command: 'REFRAL_TEST=1 pnpm dev', cwd: fileURLToPath(new URL('../', import.meta.url)),
    url: 'http://127.0.0.1:4173/examples/index.html', reuseExistingServer: false, timeout: 30_000 },
});

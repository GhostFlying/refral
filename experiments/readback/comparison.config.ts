import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from './playwright.config';

export default defineConfig({
  ...base,
  outputDir: fileURLToPath(new URL('../../artifacts/readback-comparison/playwright', import.meta.url)),
  reporter: [
    ['list'],
    [
      'json',
      { outputFile: fileURLToPath(new URL('../../artifacts/readback-comparison/correctness.json', import.meta.url)) },
    ],
  ],
  projects: [
    { name: 'comparison', testMatch: 'comparison.spec.ts' },
    {
      name: 'baseline',
      testDir: fileURLToPath(new URL('../../tests/chrome', import.meta.url)),
      testMatch: ['cts.spec.ts', 'demo.spec.ts', 'lifecycle.spec.ts'],
      use: { baseURL: 'http://127.0.0.1:4175' },
    },
  ],
});

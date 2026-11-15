import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from './comparison.config';

export default defineConfig({
  ...base,
  timeout: 1_800_000,
  reporter: [
    ['list'],
    [
      'json',
      { outputFile: fileURLToPath(new URL('../../artifacts/readback-comparison/performance.json', import.meta.url)) },
    ],
  ],
  projects: [{ name: 'performance', testMatch: 'comparison-benchmark.spec.ts' }],
});

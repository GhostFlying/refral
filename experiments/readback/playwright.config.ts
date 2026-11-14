import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../../playwright.config';

const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL('./', import.meta.url)),
  testMatch: 'readback.spec.ts',
  outputDir: fileURLToPath(new URL('../../artifacts/readback/playwright', import.meta.url)),
  reporter: [
    ['list'],
    ['json', { outputFile: fileURLToPath(new URL('../../artifacts/readback/chrome-results.json', import.meta.url)) }],
  ],
  projects: [
    { name: 'readback', testMatch: 'readback.spec.ts' },
    {
      name: 'baseline',
      testDir: fileURLToPath(new URL('../../tests/chrome', import.meta.url)),
      testMatch: ['cts.spec.ts', 'demo.spec.ts'],
      use: { baseURL: 'http://127.0.0.1:4175' },
    },
  ],
  webServer: [
    {
      command: 'REFRAL_TEST=1 pnpm exec vite --host 127.0.0.1 --port 4175 --strictPort',
      cwd: root,
      url: 'http://127.0.0.1:4175/tests/fixtures/runner.html',
      reuseExistingServer: false,
    },
    {
      command: 'REFRAL_TEST=1 REFRAL_BENCHMARK=1 pnpm exec vite --host 127.0.0.1 --port 4176 --strictPort',
      cwd: root,
      url: 'http://127.0.0.1:4176/tests/fixtures/runner.html',
      reuseExistingServer: false,
    },
  ],
});

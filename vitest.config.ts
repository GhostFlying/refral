import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: {
    '@refral/core-api': fileURLToPath(new URL('./packages/core-api/src/index.ts', import.meta.url)),
    '@refral/core-js': fileURLToPath(new URL('./packages/core-js/src/index.ts', import.meta.url)),
    '@refral/core-wasm': fileURLToPath(new URL('./packages/core-wasm/src/index.ts', import.meta.url)),
    '@refral/compiler': fileURLToPath(new URL('./packages/compiler/src/index.ts', import.meta.url)),
  } },
  test: { include: ['tests/unit/**/*.test.ts', 'tests/core/**/*.test.ts', 'packages/**/*.test.ts'] },
});

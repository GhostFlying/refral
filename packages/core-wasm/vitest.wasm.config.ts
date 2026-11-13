import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@refral/core-api': fileURLToPath(new URL('../core-api/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['tests/*.integration.ts'] },
});

import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { cp, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  plugins: [{
    name: 'refral-deployment-assets',
    async closeBundle() {
      for (const relative of ['artifacts/compiler/compiler.mjs', 'artifacts/compiler/compiler.wasm', 'artifacts/fixtures/render-to-texture.mjs', 'artifacts/core-selection/core.wasm', 'artifacts/core-wasm/refral_core.wasm']) {
        const destination = path(`./dist/${relative}`);
        await mkdir(dirname(destination), { recursive: true });
        await cp(path(`./${relative}`), destination);
      }
      await cp(path('./third_party/demo'), path('./dist/third_party/demo'), { recursive: true });
    },
  }],
  resolve: {
    alias: {
      '@refral/webgl': path('./packages/webgl/src/index.ts'),
      '@refral/browser-host': path('./packages/browser-host/src/index.ts'),
      '@refral/compiler': path('./packages/compiler/src/index.ts'),
      '@refral/core-api': path('./packages/core-api/src/index.ts'),
      '@refral/core-js': path('./packages/core-js/src/index.ts'),
      '@refral/core-wasm': path('./packages/core-wasm/src/index.ts'),
    },
  },
  server: { host: '127.0.0.1', port: 4173, strictPort: true, hmr: process.env.REFRAL_TEST !== '1',
    headers: process.env.REFRAL_BENCHMARK === '1' ? {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    } : undefined,
    watch: { ignored: ['**/artifacts/**', '**/third_party/**', '**/target/**'] } },
  build: { outDir: 'dist', rollupOptions: { input: {
    validation: path('./examples/index.html'),
    selection: path('./experiments/core-selection/index.html'),
    triangle: path('./examples/triangle/index.html'),
    domDeployment: path('./tests/fixtures/dom-deployment.html'),
  } } },
});

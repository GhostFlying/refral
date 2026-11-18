import { expect, test } from '@playwright/test';

for (const core of ['native', 'js', 'rust'] as const) {
  for (const worker of [false, true]) {
    test(`${core} finish in ${worker ? 'Worker' : 'Window'}`, async ({ page }) => {
      await page.goto('/tests/fixtures/runner.html');
      const result = await page.evaluate(async ({ core, worker }) => {
        const path = '/tests/fixtures/finish-cases.ts';
        if (!worker) return (await import(/* @vite-ignore */ path)).checkFinish(core);
        const client = new Worker(path, { type: 'module' });
        try {
          const reply = new Promise((resolve, reject) => {
            client.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.value);
            client.onerror = error => reject(new Error(error.message));
          });
          client.postMessage(core);
          return await reply;
        } finally { client.terminate(); }
      }, { core, worker });
      const states = core === 'native' ? Array(9).fill('complete') : [
        'complete', 'complete', 'pending', 'pending', 'complete', 'pending', 'complete', 'pending', 'complete',
      ];
      expect(result).toEqual({ core, worker, states, pixel: [0, 255, 0, 255], error: 0, validation: [] });
    });
  }
}

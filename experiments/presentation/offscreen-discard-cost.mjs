import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const output = process.argv[2] ?? 'artifacts/offscreen-discard';
await mkdir(output, { recursive: true });
const server = await createServer({ server: { port: 4273, strictPort: false, hmr: false } });
await server.listen();
try {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(new URL('tests/fixtures/runner.html', server.resolvedUrls.local[0]).href);
    const data = await page.evaluate(async () => {
      const { OffscreenDiscard } = await import('/packages/browser-host/src/offscreen-discard.ts');
      const { QueueCompletion } = await import('/packages/browser-host/src/queue-completion.ts');
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('A WebGPU adapter is required.');
      const device = await adapter.requestDevice();
      const errors = [];
      device.addEventListener('uncapturederror', event => errors.push(event.error.message));
      const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
      function setup(kind, format) {
        const stats = { submits: 0, copies: 0, passes: 0, offscreenDiscardProbes: 0,
          offscreenDiscards: 0, offscreenDiscardIndeterminate: 0, allocatedTextureBytes: 0,
          allocatedBufferBytes: 0, peakAllocatedTextureBytes: 0, peakAllocatedBufferBytes: 0 };
        const placeholder = document.createElement('canvas');
        placeholder.width = placeholder.height = 16;
        if (kind === 'visible') document.body.append(placeholder);
        const canvas = kind === 'standalone' ? new OffscreenCanvas(16, 16) : placeholder.transferControlToOffscreen();
        const context = canvas.getContext('webgpu');
        const alphaMode = format === 'rgba16float' ? 'premultiplied' : 'opaque';
        context.configure({ device, format, alphaMode, usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT });
        const completion = new QueueCompletion(device.queue);
        const probe = OffscreenDiscard.create(device, format, alphaMode, stats, completion);
        if (!probe) throw new Error('Cannot allocate the WebGPU lifetime probe.');
        function publish() {
          const texture = context.getCurrentTexture();
          const encoder = device.createCommandEncoder();
          encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear',
            storeOp: 'store', clearValue: [0, 0, 0, 0] }] }).end();
          device.queue.submit([encoder.finish()]);
          probe.published(texture);
          return texture;
        }
        function close() {
          context.unconfigure();
          probe.dispose();
          placeholder.remove();
        }
        return { probe, stats, publish, close };
      }
      let timerStepMs = Infinity;
      let tick = performance.now();
      for (let count = 0; count < 50000; count++) {
        const now = performance.now();
        if (now > tick) timerStepMs = Math.min(timerStepMs, now - tick);
        tick = now;
      }
      const preferred = navigator.gpu.getPreferredCanvasFormat();
      const warmups = 5, repetitions = 30, sameTurnCalls = 64;
      const results = [];
      for (const format of [preferred, 'rgba16float']) for (const kind of ['standalone', 'visible']) {
        const { probe, stats, publish, close } = setup(kind, format);
        const samples = [];
        try {
          for (let index = -warmups; index < repetitions; index++) {
            publish();
            await nextFrame(); await nextFrame();
            const t0 = performance.now();
            const discarded = probe.discarded();
            const t1 = performance.now();
            const probesBefore = stats.offscreenDiscardProbes;
            for (let call = 0; call < sameTurnCalls; call++) probe.discarded();
            const t2 = performance.now();
            if (stats.offscreenDiscardProbes !== probesBefore || discarded !== (kind === 'visible')) {
              throw new Error('Unexpected scheduling or texture liveness in ' + format + ' ' + kind + ' sample ' + index);
            }
            if (index >= 0) samples.push({ probeMs: t1 - t0, sameTurnBatchMs: t2 - t1 });
          }
        } finally { close(); }
        const perCall = samples.map(sample => sample.probeMs).sort((a, b) => a - b);
        results.push({ kind, format, samples, stats, p50Ms: perCall[Math.ceil(perCall.length * 0.5) - 1],
          p95Ms: perCall[Math.ceil(perCall.length * 0.95) - 1] });
      }
      // Expire the two actual published textures independently; no browser prototype or application context is changed.
      const failures = [];
      for (const cause of ['source', 'control', 'both', 'forgotten']) {
        const { probe, stats, publish, close } = setup('standalone', 'rgba16float');
        try {
          const source = publish();
          if (cause === 'source' || cause === 'both') source.destroy();
          if (cause === 'control' || cause === 'both') Reflect.get(probe, 'pair').control.destroy();
          if (cause === 'forgotten') probe.forget();
          await Promise.resolve();
          const discarded = probe.discarded();
          failures.push({ cause, discarded, probes: stats.offscreenDiscardProbes, indeterminate: stats.offscreenDiscardIndeterminate });
        } finally { close(); }
      }
      await device.queue.onSubmittedWorkDone();
      await nextFrame();
      device.destroy();
      return { userAgent: navigator.userAgent, adapter: Object.fromEntries(['vendor', 'architecture', 'device', 'description'].map(key => [key, adapter.info[key]])), timerStepMs, warmups, repetitions,
        sameTurnCalls, results, failures, errors };
    });
    await writeFile(join(output, 'cost.json'), JSON.stringify({ browser: browser.version(), ...data }, null, 2) + '\n');
    assert.deepEqual(data.errors, []);
    for (const { stats } of data.results) {
      assert.equal(stats.offscreenDiscardIndeterminate, 0);
      assert.equal(stats.allocatedTextureBytes, 0);
      assert.equal(stats.allocatedBufferBytes, 0);
    }
    assert.deepEqual(data.failures, [
      { cause: 'source', discarded: true, probes: 1, indeterminate: 0 },
      { cause: 'control', discarded: false, probes: 1, indeterminate: 1 },
      { cause: 'both', discarded: false, probes: 1, indeterminate: 1 },
      { cause: 'forgotten', discarded: false, probes: 0, indeterminate: 0 },
    ]);
  } finally { await browser.close(); }
} finally { await server.close(); }

import { BrowserHost } from '@refral/browser-host';
import type { TargetSnapshot } from '@refral/core-api';

export async function createInlineHost() {
  const canvas = new OffscreenCanvas(64, 64);
  const host = await BrowserHost.create(canvas, { alpha: false, depth: true });
  let sequence = 0;
  return {
    host,
    environment: host.environment,
    resize(width: number, height: number) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    },
    capture(target: TargetSnapshot) {
      const started = performance.now();
      const result = host.captureCanvas(target);
      return {
        ...result,
        sequence: ++sequence,
        roundTripMs: performance.now() - started,
        workerExecutionMs: 0,
        workerCaptureMs: 0,
      };
    },
    injectFailure(): never {
      throw new Error('Failure injection belongs to the worker transport.');
    },
    timeout(): never {
      throw new Error('Timeout injection belongs to the worker transport.');
    },
    async inspect() {
      host.flush();
      await host.device.queue.onSubmittedWorkDone();
      return {
        stats: { ...host.stats },
        errors: [...host.errors],
        canvas: host.canvasReadbackStats ? { ...host.canvasReadbackStats } : null,
      };
    },
    dispose: () => host.dispose(),
  };
}

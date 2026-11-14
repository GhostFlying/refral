import type { CoreKind } from '@refral/core-api';
import { runSequence } from './scene';

export { probeAgent } from './primitives';
export async function probeOwnWorker() {
  const worker = new Worker(new URL('./agent-probe-worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<Awaited<ReturnType<typeof import('./primitives').probeAgent>>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('GPU-owner worker probe timed out.')), 15_000);
      worker.onmessage = (event) => {
        clearTimeout(timeout);
        if (event.data.failure) reject(new Error(event.data.failure));
        else resolve(event.data);
      };
      worker.onerror = (event) => {
        clearTimeout(timeout);
        reject(new Error(event.message));
      };
      worker.postMessage({});
    });
  } finally {
    worker.terminate();
  }
}

export async function probeSharedReadback(core: CoreKind, caller: 'window' | 'worker') {
  if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    throw new Error('This shared-reply experiment requires cross-origin isolation.');
  }
  let timerTicks = 0;
  let startedTicks = 0;
  let endedTicks = 0;
  const observe = (phase: 'start' | 'end') => {
    if (phase === 'start') startedTicks = timerTicks;
    else endedTicks = timerTicks;
  };
  const timer = setInterval(() => {
    timerTicks++;
  }, 5);
  try {
    if (caller === 'window') {
      const result = await runSequence(core, 'spin', observe);
      return { caller, crossOriginIsolated, timerTicksDuringSyncSequence: endedTicks - startedTicks, result };
    }
    const worker = new Worker(new URL('./client-worker.ts', import.meta.url), { type: 'module' });
    try {
      const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Worker client experiment timed out.')), 30_000);
        worker.onmessage = (event) => {
          if (event.data.kind === 'phase') {
            observe(event.data.phase);
            return;
          }
          clearTimeout(timeout);
          resolve(event.data);
        };
        worker.onerror = (event) => {
          clearTimeout(timeout);
          reject(new Error(event.message));
        };
        worker.postMessage({ core });
      });
      return { caller, crossOriginIsolated, timerTicksDuringSyncSequence: endedTicks - startedTicks, result };
    } finally {
      worker.terminate();
    }
  } finally {
    clearInterval(timer);
  }
}

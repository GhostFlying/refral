/// <reference lib="webworker" />
import type { CoreKind } from '@refral/core-api';
import { runSequence } from './scene';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (event: MessageEvent<{ core: CoreKind }>) => {
  try {
    const control = new Int32Array(new SharedArrayBuffer(4));
    const waitProbe = Atomics.wait(control, 0, 0, 0);
    const result = await runSequence(event.data.core, 'wait', (phase) => scope.postMessage({ kind: 'phase', phase }));
    scope.postMessage({ ...result, waitProbe });
  } catch (error) {
    scope.postMessage({ failure: String(error) });
  }
};

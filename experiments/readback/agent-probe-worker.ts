/// <reference lib="webworker" />
import { probeAgent } from './primitives';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async () => {
  try {
    scope.postMessage(await probeAgent('wait'));
  } catch (error) {
    scope.postMessage({ failure: String(error) });
  }
};

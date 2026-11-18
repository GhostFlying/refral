import { runDiscardCase } from './offscreen-discard';
import type { Backend, Scenario } from './offscreen-discard';

type Request = { canvas: OffscreenCanvas; backend: Backend; scenario: Scenario };
globalThis.onmessage = async (event: MessageEvent<Request>) => {
  const { canvas, backend, scenario } = event.data;
  const capture = (step: string) => new Promise<void>(resolve => {
    globalThis.addEventListener('message', () => resolve(), { once: true });
    postMessage({ capture: step });
  });
  globalThis.onmessage = null;
  try { postMessage({ result: await runDiscardCase(canvas, backend, scenario, capture) }); }
  catch (error) { postMessage({ error: String(error) }); }
};

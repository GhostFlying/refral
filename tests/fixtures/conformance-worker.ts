import { prepareContextFactory, getTestingHooks } from '@refral/webgl';
import { installConformanceBridge } from './conformance-init';
import type { CanvasBridge, ConformanceBackend, WorkerObservation } from './conformance-init';

interface OfficialWorkerGlobal {
  importScripts(url: string): void;
  postMessage(value: unknown): void;
}

export async function runOfficialWorker(): Promise<void> {
  const worker = globalThis as unknown as OfficialWorkerGlobal;
  const source = new URL(location.href);
  const token = source.searchParams.get('__refral_worker');
  const backend = source.searchParams.get('__refral_backend') as ConformanceBackend;
  if (!token || !['native', 'js', 'rust'].includes(backend)) throw new Error('Invalid official worker entry.');
  source.searchParams.delete('__refral_worker');
  source.searchParams.delete('__refral_backend');
  const send = (detail: WorkerObservation) => worker.postMessage({ __refralWorker: token, detail });
  const factory = backend === 'native' ? null : await prepareContextFactory({ core: backend });
  const canvases = new WeakMap<HTMLCanvasElement | OffscreenCanvas, WebGLRenderingContext>();
  const contexts = new Set<WebGLRenderingContext>();
  function record(context: WebGLRenderingContext, kind: string) {
    if (contexts.has(context)) return;
    contexts.add(context);
    const hooks = factory ? getTestingHooks(context) : null;
    const debug = hooks ? null : context.getExtension('WEBGL_debug_renderer_info');
    const adapter = hooks ? hooks.environment.adapter as Record<string, unknown> : {
      renderer: context.getParameter(context.RENDERER),
      unmaskedRenderer: debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
    };
    send({ type: 'context', context: { kind, actualCore: hooks?.core ?? 'native',
      adapter, attributes: context.getContextAttributes() } });
    if (hooks) void hooks.device.lost.then(info => {
      if (info.reason !== 'destroyed') send({ type: 'error', message: info.message });
    });
  }
  const bridge: CanvasBridge = {
    acquire(canvas, kind, attributes) {
      const existing = canvases.get(canvas);
      if (existing) return kind === 'webgl2' ? null : existing;
      if (kind === 'webgl2') {
        send({ type: 'gap', message: 'The selected worker core exposes WebGL1.' });
        throw new DOMException('Worker WebGL2 acquisition is unavailable.', 'NotSupportedError');
      }
      const context = factory!(canvas, attributes);
      canvases.set(canvas, context);
      record(context, kind);
      return context;
    },
    context: record,
    error: value => send({ type: 'error', name: value.name, message: value.message }),
    gap: value => send({ type: 'gap', message: value.message }),
  };
  installConformanceBridge({ backend, worker: bridge });
  globalThis.addEventListener('message', event => {
    if (event.data?.__refralFinish !== token) return;
    event.stopImmediatePropagation();
    void (async () => {
      if (factory) {
        for (const context of contexts) {
          context.flush();
          const hooks = getTestingHooks(context);
          await hooks.device.queue.onSubmittedWorkDone();
        }
        await new Promise(resolve => setTimeout(resolve, 0));
        for (const context of contexts) {
          for (const message of getTestingHooks(context).errors) send({ type: 'error', message });
        }
        await factory.dispose();
      }
    })().catch(error => send({ type: 'error', message: String(error) }))
      .finally(() => send({ type: 'finished' }));
  }, true);
  worker.importScripts(source.href);
  send({ type: 'ready' });
}

export type ConformanceBackend = 'native' | 'js' | 'rust';

export type CanvasSurface = 'html-canvas' | 'offscreen-canvas';

export interface OfficialFile { url: string }
export interface OfficialTest { iframe: HTMLIFrameElement; testFile: OfficialFile }
export type OfficialReport = (type: number, url: string, message: unknown,
  success?: boolean, skipped?: boolean) => unknown;
export interface OfficialHarness {
  files: OfficialFile[];
  runningTests: Record<string, OfficialTest>;
  reportFunc: OfficialReport;
  runTests(options: { start: number; count: number }): void;
  startTest(iframe: HTMLIFrameElement, file: OfficialFile, version: number): void;
  notifyFinished(url: string): void;
  timeout(test: OfficialTest): void;
  clearTimeout(test: OfficialTest): void;
  setTimeoutDelay(value: number): void;
}
export interface ConformanceDiagnostic {
  kind: string; name: string; message: string; url: string; level?: 'observed'; frameUrl?: string;
}
export interface ConformanceGap { kind: string; message: string; url: string }
export interface WorkerContextRecord {
  kind: string;
  actualCore: ConformanceBackend;
  attributes: WebGLContextAttributes | null;
  adapter: Record<string, unknown>;
}
export type WorkerObservation =
  | { type: 'ready' | 'finished' }
  | { type: 'context'; context: WorkerContextRecord }
  | { type: 'error'; name?: string; message: string }
  | { type: 'gap'; message: string };

export interface CanvasBridge {
  acquire(canvas: HTMLCanvasElement | OffscreenCanvas, kind: string, attributes: WebGLContextAttributes | undefined,
    url: string, surface: CanvasSurface): WebGLRenderingContext | null;
  context(context: WebGLRenderingContext, kind: string, attributes: WebGLContextAttributes | undefined,
    url: string, surface: CanvasSurface): void;
  error(value: ConformanceDiagnostic): void;
  gap(value: ConformanceGap): void;
}
export interface ConformanceBridge extends CanvasBridge {
  worker(url: string, script: string, finish: () => Promise<void>): (event: WorkerObservation) => void;
  realmTransfer?(url: string): void;
  attach(harness: OfficialHarness): void;
  report: OfficialReport;
  start(harness: OfficialHarness, original: OfficialHarness['startTest'],
    iframe: HTMLIFrameElement, file: OfficialFile, version: number): void;
  finish(harness: OfficialHarness, original: (argument: never) => void,
    argument: string | OfficialTest, completion: 'finished' | 'timeout'): void;
}

/** Serialized into every browser document by Playwright. Keep runtime helpers inside this function. */
export function installConformanceBridge(options: { backend: ConformanceBackend; worker?: CanvasBridge }): void {
  const runnerPath = '/third_party/cts/sdk/tests/webgl-conformance-tests.html';
  const testsPath = '/third_party/cts/sdk/tests/';
  let isRunner = false;
  if (!options.worker) {
    Reflect.set(window, '__refralConformanceInitBackend', options.backend);
    isRunner = location.pathname === runnerPath;
    let isChild = location.pathname.startsWith(testsPath);
    try { isChild ||= window.parent.location.pathname.startsWith(testsPath); } catch { /* Cross-origin frame. */ }
    if (!isRunner && !isChild) return;
  }

  function bridge(): ConformanceBridge | null {
    let current: Window = window;
    for (let depth = 0; depth < 12; depth++) {
      try {
        const value = Reflect.get(current, '__refralConformanceBridge') as ConformanceBridge | undefined;
        if (value) return value;
        if (current === current.parent) break;
        current = current.parent;
      } catch { break; }
    }
    return null;
  }

  function diagnostic(kind: string, reason: unknown, url = location.href): void {
    const detail = reason && typeof reason === 'object'
      ? reason as { name?: unknown; message?: unknown } : null;
    const value: ConformanceDiagnostic = { kind,
      name: typeof detail?.name === 'string' ? detail.name : 'Error',
      message: typeof detail?.message === 'string' ? detail.message : String(reason), url,
      frameUrl: location.href, ...(kind === 'resource' ? { level: 'observed' as const } : {}) };
    const target = options.worker ?? bridge();
    if (target) target.error(value);
    else console.error('[RefralConformanceBridgeError]', JSON.stringify(value));
  }

  function requiredBridge(): ConformanceBridge {
    const value = bridge();
    if (value) return value;
    const error = new DOMException('Selected-core conformance parent bridge is unavailable.', 'NotSupportedError');
    diagnostic('bridge-missing', error);
    throw error;
  }

  globalThis.addEventListener('error', event => {
    if (typeof Element !== 'undefined' && event.target instanceof Element) {
      const source = event.target.getAttribute('src') ?? event.target.getAttribute('href');
      const url = source ? new URL(source, event.target.baseURI).href : location.href;
      diagnostic('resource', { name: 'ResourceLoadError',
        message: `Failed to load ${event.target.tagName.toLowerCase()} dependency.` }, url);
    } else {
      diagnostic('page', event.error ?? { name: 'Error', message: event.message }, event.filename || location.href);
    }
  }, true);
  globalThis.addEventListener('unhandledrejection', event => diagnostic('promise', event.reason));

  const ChildArray = Array;
  const isArray = Array.isArray;
  const isView = ArrayBuffer.isView;
  const ChildBytes = Uint8Array;
  const copyBytes = Uint8Array.prototype.set;
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  const viewTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!;
  const viewBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;
  const viewOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!;
  const viewBytes = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;
  const viewLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length')!.get!;
  const viewConstructors = new Map<string, new (length: number) => ArrayBufferView>([
    ['Int8Array', Int8Array], ['Uint8Array', Uint8Array], ['Uint8ClampedArray', Uint8ClampedArray],
    ['Int16Array', Int16Array], ['Uint16Array', Uint16Array], ['Int32Array', Int32Array],
    ['Uint32Array', Uint32Array], ['Float32Array', Float32Array], ['Float64Array', Float64Array],
    ['BigInt64Array', BigInt64Array], ['BigUint64Array', BigUint64Array],
  ]);
  const realmGetters = new Set(['getParameter', 'getVertexAttrib', 'getUniform',
    'getAttachedShaders', 'getSupportedExtensions']);
  const childContexts = new WeakMap<WebGLRenderingContext, WebGLRenderingContext>();

  function childResult(value: unknown): unknown {
    if (options.worker) return value; // The worker factory already lives in this realm.
    if (isArray(value)) {
      const result = new ChildArray(value.length);
      for (let index = 0; index < value.length; index++) result[index] = value[index];
      bridge()?.realmTransfer?.(location.href);
      return result;
    }
    if (isView(value)) {
      const Constructor = viewConstructors.get(Reflect.apply(viewTag, value, []));
      if (Constructor) {
        const result = new Constructor(Reflect.apply(viewLength, value, []));
        const source = new ChildBytes(Reflect.apply(viewBuffer, value, []),
          Reflect.apply(viewOffset, value, []), Reflect.apply(viewBytes, value, []));
        const destination = new ChildBytes(Reflect.apply(viewBuffer, result, []));
        Reflect.apply(copyBytes, destination, [source]);
        bridge()?.realmTransfer?.(location.href);
        return result;
      }
    }
    return value;
  }

  function childContext(raw: WebGLRenderingContext): WebGLRenderingContext {
    const existing = childContexts.get(raw);
    if (existing) return existing;
    const methods = new Map<PropertyKey, { original: unknown; wrapped: (...args: unknown[]) => unknown }>();
    const context = new Proxy(raw, {
      // Provide the child realm's instanceof identity while reads, writes and has checks use the facade.
      getPrototypeOf: target => Reflect.isExtensible(target)
        ? WebGLRenderingContext.prototype : Reflect.getPrototypeOf(target),
      get(target, property) {
        const original = Reflect.get(target, property, target);
        if (typeof property !== 'string' || !realmGetters.has(property) || typeof original !== 'function') return original;
        let method = methods.get(property);
        if (!method || method.original !== original) {
          method = { original, wrapped: (...args) => childResult(Reflect.apply(original, target, args)) };
          methods.set(property, method);
        }
        return method.wrapped;
      },
    });
    childContexts.set(raw, context);
    return context;
  }

  const toString = String;
  function installCanvasContext(prototype: HTMLCanvasElement | OffscreenCanvas, surface: CanvasSurface): void {
    const original = prototype.getContext;
    const width = Object.getOwnPropertyDescriptor(prototype, 'width')!.get!;
    const selected = new WeakSet<HTMLCanvasElement | OffscreenCanvas>();
    const nativeMode = new WeakSet<HTMLCanvasElement | OffscreenCanvas>();
    Object.defineProperty(prototype, 'getContext', { configurable: true, writable: true,
      value(this: HTMLCanvasElement | OffscreenCanvas, contextId: unknown, attributes?: WebGLContextAttributes) {
        Reflect.apply(width, this, []);
        if (arguments.length === 0 || typeof contextId === 'symbol') {
          return Reflect.apply(original, this, [...arguments]);
        }
        const kind = toString(contextId);
        if (surface === 'offscreen-canvas' && kind === 'experimental-webgl') {
          // The OffscreenRenderingContextId enum excludes the legacy HTMLCanvasElement alias.
          if (options.backend === 'native') return Reflect.apply(original, this, [kind, attributes]);
          throw new TypeError('experimental-webgl is not an OffscreenCanvas context type.');
        }
        if (kind !== 'webgl' && kind !== 'experimental-webgl' && kind !== 'webgl2') {
          if (selected.has(this) && (kind === '2d' || kind === 'bitmaprenderer' || kind === 'webgpu')) return null;
          const context = Reflect.apply(original, this, [kind, attributes]);
          if (context) nativeMode.add(this);
          return context;
        }
        if (options.backend === 'native') {
          const context = Reflect.apply(original, this, [kind, attributes]) as WebGLRenderingContext | null;
          if (context) (options.worker ?? requiredBridge()).context(context, kind, attributes, location.href, surface);
          return context;
        }
        // The host acquires the canvas's WebGPU slot during the first selected WebGL call.
        if (!selected.has(this) && nativeMode.has(this)) return null;
        try {
          const context = (options.worker ?? requiredBridge()).acquire(this, kind, attributes, location.href, surface);
          if (!context) return null;
          selected.add(this);
          return childContext(context);
        } catch (error) {
          diagnostic('context-acquisition', error);
          throw error;
        }
      } });
  }
  if (!options.worker) installCanvasContext(HTMLCanvasElement.prototype, 'html-canvas');
  if (typeof OffscreenCanvas !== 'undefined') installCanvasContext(OffscreenCanvas.prototype, 'offscreen-canvas');

  if (typeof Worker !== 'undefined') {
    const OriginalWorker = Worker;
    globalThis.Worker = new Proxy(OriginalWorker, { construct(target, args, newTarget) {
      if (!args.length) return Reflect.construct(target, args, newTarget);
      const source = new URL(args[0], options.worker ? location.href : document.baseURI);
      if (options.worker || source.origin !== location.origin || !source.pathname.startsWith(testsPath)
        || (args[1]?.type && args[1].type !== 'classic')) {
        if (options.backend === 'native') return Reflect.construct(target, args, newTarget);
        const message = `Selected-core instrumentation is unavailable for this worker: ${source.href}`;
        (options.worker ?? requiredBridge()).gap({ kind: 'worker-webgl-provenance', url: location.href, message });
        throw new DOMException(message, 'NotSupportedError');
      }
      const token = crypto.randomUUID();
      const entry = new URL(source);
      entry.searchParams.set('__refral_worker', token);
      entry.searchParams.set('__refral_backend', options.backend);
      const worker = Reflect.construct(target, [entry.href, ...args.slice(1)], newTarget) as Worker;
      const post = worker.postMessage.bind(worker);
      const terminate = worker.terminate.bind(worker);
      let ready = false;
      let closed = false;
      let drained: (() => void) | undefined;
      const pending: { message: unknown; transfer: Transferable[] }[] = [];
      const observe = requiredBridge().worker(location.href, source.href, async () => {
        if (closed) return;
        try {
          if (ready) await new Promise<void>((resolve, reject) => {
            const deadline = setTimeout(() => reject(new Error('Worker resource finalization timed out.')), 2000);
            drained = () => { clearTimeout(deadline); resolve(); };
            post({ __refralFinish: token });
          });
        } finally { terminate(); }
      });
      // Preserve immediate structured-clone and transfer semantics while the worker initializes.
      Object.defineProperty(worker, 'postMessage', { configurable: true, writable: true,
        value(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions) {
          if (ready || closed) return Reflect.apply(post, worker, arguments);
          if (!arguments.length) throw new TypeError('Worker.postMessage requires a message.');
          const transfer = Array.from(transferOrOptions && Symbol.iterator in Object(transferOrOptions)
            ? transferOrOptions as Iterable<Transferable> : (transferOrOptions as StructuredSerializeOptions | undefined)?.transfer ?? []);
          pending.push(structuredClone({ message, transfer }, { transfer }));
        } });
      worker.terminate = () => { closed = true; pending.length = 0; terminate(); };
      worker.addEventListener('message', event => {
        if (event.data?.__refralWorker !== token) return;
        event.stopImmediatePropagation();
        const detail = event.data.detail as WorkerObservation;
        observe(detail);
        if (detail.type === 'ready') {
          ready = true;
          delete (worker as Partial<Worker>).postMessage;
          for (const item of pending) post(item.message, item.transfer);
          pending.length = 0;
        } else if (detail.type === 'finished') drained?.();
      });
      worker.addEventListener('error', event => observe({ type: 'error', name: event.error?.name, message: event.message }));
      return worker;
    } });
  }

  if (!isRunner) return;
  type HarnessConstructor = (new (...args: unknown[]) => OfficialHarness) & { prototype: OfficialHarness };
  let harnessModule: { TestHarness: HarnessConstructor } | undefined;
  Object.defineProperty(window, 'WebGLTestHarnessModule', { configurable: true,
    get() { return harnessModule; },
    set(value: { TestHarness: HarnessConstructor }) {
      const Original = value.TestHarness;
      const Wrapped = function(this: OfficialHarness, ...args: unknown[]) {
        const originalReport = args[2] as OfficialReport;
        args[2] = function(this: unknown, ...reportArgs: Parameters<OfficialReport>) {
          requiredBridge().report(...reportArgs);
          return Reflect.apply(originalReport, this, reportArgs);
        };
        const instance = Reflect.construct(Original, args) as OfficialHarness;
        const originalStart = instance.startTest;
        const originalFinish = instance.notifyFinished;
        const originalTimeout = instance.timeout;
        instance.startTest = function(iframe, file, version) {
          requiredBridge().start(this, originalStart, iframe, file, version);
        };
        instance.notifyFinished = function(url) {
          requiredBridge().finish(this, originalFinish as (argument: never) => void, url, 'finished');
        };
        instance.timeout = function(test) {
          requiredBridge().finish(this, originalTimeout as (argument: never) => void, test, 'timeout');
        };
        requiredBridge().attach(instance);
        return instance;
      };
      Wrapped.prototype = Original.prototype;
      Object.setPrototypeOf(Wrapped, Original);
      value.TestHarness = Wrapped as unknown as HarnessConstructor;
      harnessModule = value;
    } });
}

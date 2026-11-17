import { prepareContextFactory, getTestingHooks } from '@refral/webgl';

export type CtsBackend = 'native' | 'js' | 'rust' | 'refral';
interface Assertion { success: boolean; message: string; skipped: boolean }
interface Harness {
  reportResults(path: string, success: boolean, message: string, skipped?: boolean): void;
  notifyFinished(path: string): void;
}
interface HarnessError { name: string; message: string; url?: string; line?: number; column?: number }
type CompletionStatus = 'finished' | 'error' | 'timeout';

export async function runCts(path: string, requestedBackend: CtsBackend) {
  const started = performance.now();
  const backend = requestedBackend === 'refral' ? 'js' : requestedBackend;
  const response = await fetch(`/third_party/cts/${path}`);
  if (!response.ok) throw new Error(`CTS fixture missing (${response.status}): ${path}. Run pnpm deps:sync.`);
  const html = new DOMParser().parseFromString(await response.text(), 'text/html');
  const factory = backend === 'native' ? null : await prepareContextFactory({ core: backend });
  const iframe = document.createElement('iframe');
  iframe.src = '/tests/fixtures/cts-frame.html';
  const loaded = new Promise<void>((resolve) => { iframe.onload = () => resolve(); });
  document.body.appendChild(iframe);
  await loaded;
  const frame = iframe.contentWindow as Window & typeof globalThis;
  const doc = frame.document;
  const testUrl = new URL(`/third_party/cts/${path}`, location.origin);
  frame.history.replaceState(null, '', testUrl);
  const base = doc.createElement('base');
  base.href = testUrl.href;
  doc.head.appendChild(base);
  const assertions: Assertion[] = [];
  const errors: HarnessError[] = [];
  const contexts: ReturnType<NonNullable<typeof factory>>[] = [];
  const canvasContexts = new WeakMap<HTMLCanvasElement, WebGLRenderingContext>();
  let finish!: (status: CompletionStatus) => void;
  let completed: CompletionStatus | null = null;
  const completion = new Promise<CompletionStatus>((resolve) => {
    finish = status => {
      if (completed !== null) return;
      completed = status;
      resolve(status);
    };
  });
  const globals = window as unknown as { webglTestHarness?: Harness };
  const previous = globals.webglTestHarness;
  globals.webglTestHarness = {
    reportResults(_path, success, message, skipped = false) { assertions.push({ success, message, skipped }); },
    notifyFinished() { finish('finished'); },
  };
  frame.addEventListener('error', event => {
    const target = event.target;
    if (target instanceof frame.Element) {
      const source = target.getAttribute('src') ?? target.getAttribute('href');
      const url = source ? new URL(source, target.baseURI).href : testUrl.href;
      errors.push({ name: 'ResourceLoadError', message: `Failed to load CTS ${target.tagName.toLowerCase()} dependency ${url}`, url });
    } else {
      errors.push({ name: event.error?.name ?? 'Error', message: event.message,
        url: event.filename || testUrl.href, line: event.lineno, column: event.colno });
    }
    finish('error');
  }, true);
  frame.addEventListener('unhandledrejection', event => {
    const reason: unknown = event.reason;
    const detail = reason && typeof reason === 'object' ? reason as { name?: unknown; message?: unknown } : null;
    errors.push({ name: typeof detail?.name === 'string' ? detail.name : 'UnhandledRejection',
      message: typeof detail?.message === 'string' ? detail.message : String(reason), url: testUrl.href });
    finish('error');
  });
  doc.body.innerHTML = html.body.innerHTML;
  const timeoutMs = 30_000;
  const initializationMs = performance.now() - started;
  const executionStarted = performance.now();
  const timer = setTimeout(() => finish('timeout'), timeoutMs);
  try {
    const original = frame.HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(frame.HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, kind: string, attributes?: WebGLContextAttributes) {
        if (kind !== 'webgl' && kind !== 'experimental-webgl') {
          return Reflect.apply(original, this, [kind, attributes]);
        }
        const existing = canvasContexts.get(this);
        if (existing) return existing;
        const context = factory ? factory(this, attributes)
          : Reflect.apply(original, this, [kind, attributes]) as WebGLRenderingContext | null;
        if (!context) return null;
        contexts.push(context);
        const exposed = factory ? new Proxy(context, {
          getPrototypeOf: target => Reflect.isExtensible(target)
            ? frame.WebGLRenderingContext.prototype : Reflect.getPrototypeOf(target),
        }) : context;
        canvasContexts.set(this, exposed);
        return exposed;
      },
      configurable: true,
    });
    for (const node of [...html.head.children, ...html.body.children]) {
      if (completed !== null) break;
      if (node instanceof HTMLStyleElement && node.parentElement === html.head) {
        doc.head.appendChild(doc.importNode(node, true));
        continue;
      }
      if (node instanceof HTMLLinkElement && node.parentElement === html.head && node.relList.contains('stylesheet')) {
        const link = doc.importNode(node, true) as HTMLLinkElement;
        link.href = new URL(node.getAttribute('href') ?? '', testUrl).href;
        const stylesheetLoaded = new Promise<'loaded' | 'error'>(resolve => {
          link.onload = () => resolve('loaded');
          link.onerror = () => resolve('error');
        });
        doc.head.appendChild(link);
        if (await Promise.race([stylesheetLoaded, completion]) !== 'loaded') break;
        continue;
      }
      if (!(node instanceof HTMLScriptElement)) continue;
      if (node.type && node.type !== 'text/javascript' && node.type !== 'application/javascript') {
        if (node.parentElement === html.head) doc.head.appendChild(doc.importNode(node, true));
        continue;
      }
      const script = doc.createElement('script');
      if (node.hasAttribute('src')) {
        script.src = new URL(node.getAttribute('src')!, testUrl).href;
        const scriptLoaded = new Promise<'loaded' | 'error'>(resolve => {
          script.onload = () => resolve('loaded');
          script.onerror = () => resolve('error');
        });
        doc.head.appendChild(script);
        if (await Promise.race([scriptLoaded, completion]) !== 'loaded') break;
      } else {
        script.textContent = node.textContent;
        doc.body.appendChild(script);
      }
    }
    const completionStatus = await completion;
    const originalExecutionMs = performance.now() - executionStarted;
    if (factory) {
      for (const context of contexts) {
        const hooks = getTestingHooks(context);
        try { await hooks.device.queue.onSubmittedWorkDone(); }
        catch (error) { errors.push({ name: 'GPUCompletionError', message: String(error) }); }
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      for (const context of contexts) {
        for (const message of getTestingHooks(context).errors) errors.push({ name: 'GPUValidationError', message });
      }
    }
    const environments: Record<string, unknown>[] = contexts.map(context => {
      const canvasInDocument = context.canvas instanceof frame.HTMLCanvasElement && doc.contains(context.canvas);
      if (!factory) {
        const debug = context.getExtension('WEBGL_debug_renderer_info');
        return { core: 'native', userAgent: frame.navigator.userAgent,
          version: context.getParameter(context.VERSION), renderer: context.getParameter(context.RENDERER),
          unmaskedRenderer: debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
          unmaskedVendor: debug ? context.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
          attributes: context.getContextAttributes(), canvasInDocument };
      }
      const hooks = getTestingHooks(context);
      if (hooks.core !== backend) errors.push({ name: 'CoreSelectionError',
        message: `Requested ${backend}, received ${hooks.core}` });
      return { core: hooks.core, ...hooks.environment, attributes: context.getContextAttributes(),
        canvasInDocument };
    });
    const observations: Record<string, unknown> = {
      offscreenCanvasAvailable: typeof frame.OffscreenCanvas === 'function',
      stylesheetUrls: Array.from(doc.querySelectorAll('link[rel~="stylesheet"]'), link => (link as HTMLLinkElement).href),
    };
    if (path.endsWith('/state/gl-geterror.html')) {
      const values = [1, 2, 3, 4, 5, 6].map(index => Reflect.get(frame, `err${index}`));
      observations.errorCollection = values[1] === 0 ? 'first-error' : 'multiple-errors';
      observations.errorValues = values;
    }
    const failed = assertions.filter((assertion) => !assertion.success && !assertion.skipped).length;
    const passed = assertions.filter((assertion) => assertion.success && !assertion.skipped).length;
    const status = completionStatus === 'timeout' ? 'timeout'
      : errors.some((error) => error.name === 'NotSupportedError') ? 'unsupported'
      : failed || errors.length || !passed ? 'fail' : 'pass';
    return {
      path, backend, requestedBackend, selectedCore: environments.length && environments.every(value => value.core === backend) ? backend : null,
      status, completionStatus, passed, failed, assertions, errors, environments,
      timing: { initializationMs, originalExecutionMs, totalMs: performance.now() - started, timeoutMs },
      crossOriginIsolated: frame.crossOriginIsolated,
      sharedArrayBufferAvailable: typeof frame.SharedArrayBuffer !== 'undefined', observations,
      adaptations: ['inert head shader scripts preserved in the iframe document',
        'original head stylesheet links and inline styles preserved with fixture-relative URLs',
        'iframe-scoped canvas getContext capture including detached helper canvases',
        'native Canvas2D acquisition and OffscreenCanvas methods preserved',
        'iframe errors, unhandled promise rejections and resource-load failures captured',
        'dependency loading and original completion share the per-file timeout',
        ...(factory ? ['asynchronous compiler/device/core preinitialization', 'iframe-scoped canvas getContext injection',
          'iframe-local native WebGL prototype branding for original context checks'] : []),
        'original test scripts and assertions executed unchanged'],
    };
  } finally {
    clearTimeout(timer);
    try {
      await factory?.dispose();
      if (!factory) {
        for (const context of contexts) context.getExtension('WEBGL_lose_context')?.loseContext();
      }
    } finally {
      globals.webglTestHarness = previous;
      iframe.remove();
    }
  }
}

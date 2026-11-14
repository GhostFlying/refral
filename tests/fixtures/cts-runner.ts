import { prepareContextFactory, getTestingHooks } from '@refral/webgl';

export type CtsBackend = 'native' | 'js' | 'rust' | 'refral';
interface Assertion { success: boolean; message: string; skipped: boolean }
interface Harness {
  reportResults(path: string, success: boolean, message: string, skipped?: boolean): void;
  notifyFinished(path: string): void;
}

export async function runCts(path: string, requestedBackend: CtsBackend) {
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
  doc.body.innerHTML = html.body.innerHTML;
  const assertions: Assertion[] = [];
  const errors: { name: string; message: string }[] = [];
  const contexts: ReturnType<NonNullable<typeof factory>>[] = [];
  let finish!: (status: 'finished' | 'error' | 'timeout') => void;
  const completion = new Promise<'finished' | 'error' | 'timeout'>((resolve) => { finish = resolve; });
  const globals = window as unknown as { webglTestHarness?: Harness };
  const previous = globals.webglTestHarness;
  globals.webglTestHarness = {
    reportResults(_path, success, message, skipped = false) { assertions.push({ success, message, skipped }); },
    notifyFinished() { finish('finished'); },
  };
  frame.addEventListener('error', (event) => {
    errors.push({ name: event.error?.name ?? 'Error', message: event.message });
    finish('error');
  });
  const timer = setTimeout(() => finish('timeout'), 30_000);
  try {
    if (factory) {
      const original = frame.HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(frame.HTMLCanvasElement.prototype, 'getContext', {
        value(this: HTMLCanvasElement, kind: string, attributes?: WebGLContextAttributes) {
          if (kind === 'webgl' || kind === 'experimental-webgl') {
            const existing = contexts.find((context) => context.canvas === this);
            if (existing) return existing;
            const context = factory(this, attributes);
            contexts.push(context);
            return context;
          }
          return Reflect.apply(original, this, [kind, attributes]);
        },
        configurable: true,
      });
    }
    for (const node of [...html.head.children, ...html.body.children]) {
      if (!(node instanceof HTMLScriptElement)) continue;
      if (node.type && node.type !== 'text/javascript' && node.type !== 'application/javascript') continue;
      const script = doc.createElement('script');
      if (node.hasAttribute('src')) {
        script.src = new URL(node.getAttribute('src')!, testUrl).href;
        const scriptLoaded = new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () => reject(new Error(`Failed to load CTS dependency ${script.src}`));
        });
        doc.head.appendChild(script);
        await scriptLoaded;
      } else {
        script.textContent = node.textContent;
        doc.body.appendChild(script);
      }
    }
    const completionStatus = await completion;
    const environments: Record<string, unknown>[] = contexts.map(context => {
      const hooks = getTestingHooks(context);
      if (hooks.core !== backend) errors.push({ name: 'CoreSelectionError',
        message: `Requested ${backend}, received ${hooks.core}` });
      return { core: hooks.core, ...hooks.environment, attributes: context.getContextAttributes() };
    });
    if (!factory) {
      for (const canvas of doc.querySelectorAll('canvas')) {
        const context = canvas.getContext('webgl');
        if (context) environments.push({ core: 'native', userAgent: frame.navigator.userAgent,
          version: context.getParameter(context.VERSION), renderer: context.getParameter(context.RENDERER),
          attributes: context.getContextAttributes() });
      }
    }
    const failed = assertions.filter((assertion) => !assertion.success && !assertion.skipped).length;
    const passed = assertions.filter((assertion) => assertion.success && !assertion.skipped).length;
    const status = completionStatus === 'timeout' ? 'timeout'
      : errors.some((error) => error.name === 'NotSupportedError') ? 'unsupported'
      : failed || errors.length || !passed ? 'fail' : 'pass';
    return {
      path, backend, requestedBackend, status, completionStatus, passed, failed, assertions, errors, environments,
      adaptations: factory ? ['asynchronous compiler/device/core preinitialization', 'iframe-scoped canvas getContext injection', 'original test scripts and assertions executed unchanged'] : [],
    };
  } finally {
    clearTimeout(timer);
    await factory?.dispose();
    globals.webglTestHarness = previous;
    iframe.remove();
  }
}

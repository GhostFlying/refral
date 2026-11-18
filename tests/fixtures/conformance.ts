import { prepareContextFactory, getTestingHooks } from '@refral/webgl';
import type { PreparedContextFactory } from '@refral/webgl';
import type { CanvasSurface, ConformanceBackend, ConformanceBridge, ConformanceDiagnostic, ConformanceGap,
  OfficialFile, OfficialHarness, OfficialReport, OfficialTest, WorkerExit, WorkerObservation } from './conformance-init.js';

interface ContextRecord {
  requestedCore: ConformanceBackend;
  actualCore: ConformanceBackend;
  surface: CanvasSurface;
  realm?: 'dedicated-worker';
  kind: string;
  attributes: WebGLContextAttributes | null;
  adapter: Record<string, unknown>;
  url: string;
}
type CaseScreenshot =
  | { kind: 'case-page' | 'runner-page'; file: string; width: number; height: number;
      canvas?: { id: string; x: number; y: number; width: number; height: number } }
  | { kind: 'unavailable'; message: string };
interface CaseResult {
  index: number;
  url: string;
  backend: ConformanceBackend;
  status: 'pass' | 'fail' | 'skip' | 'unsupported' | 'timeout' | 'harness-error';
  completion: 'finished' | 'timeout' | 'capability-error';
  capabilityTerminated: boolean;
  upstreamCompleted: boolean;
  passed: number;
  failed: number;
  skipped: number;
  skippedFailures: number;
  assertionTimeouts: number;
  failures: string[];
  failuresTruncated: number;
  errors: ConformanceDiagnostic[];
  lateDiagnostics?: ConformanceDiagnostic[];
  contexts: ContextRecord[];
  adapterGaps: ConformanceGap[];
  workers?: { script: string; depth: number; ready: boolean; exit?: WorkerExit; contexts: number }[];
  durationMs: number;
  realmTransfers: number;
  collectedWindowContexts?: number;
  screenshot?: CaseScreenshot;
}
interface Scope {
  factory: PreparedContextFactory | null;
  workers: { script: string; depth: number; ready: boolean; exit?: WorkerExit; contexts: ContextRecord[]; finish(): Promise<void> }[];
  canvases: WeakMap<HTMLCanvasElement | OffscreenCanvas, WebGLRenderingContext>;
  contexts: { native?: WebGLRenderingContext; selected?: WeakRef<WebGLRenderingContext>;
    errors?: string[]; device?: GPUDevice; record: ContextRecord }[];
  seenContexts: WeakSet<WebGLRenderingContext>;
  errors: ConformanceDiagnostic[];
  adapterGaps: ConformanceGap[];
  realmTransfers: number;
}
interface ActiveCase extends Scope {
  index: number;
  url: string;
  started: number;
  phase: 'running' | 'finalizing';
  passed: number;
  failed: number;
  skipped: number;
  skippedFailures: number;
  assertionTimeouts: number;
  failures: string[];
  failuresTruncated: number;
  capabilityTerminated: boolean;
  capabilityTimer: ReturnType<typeof setTimeout> | null;
}

const parameters = new URLSearchParams(location.search);
const requestedBackend = parameters.get('backend') ?? 'native';
if (!['native', 'js', 'rust'].includes(requestedBackend)) throw new RangeError('Invalid conformance backend.');
const backend = requestedBackend as ConformanceBackend;
const abortUnsupported = backend !== 'native' && parameters.get('abortUnsupported') === '1';
const timeoutMs = Number(parameters.get('timeoutMs') ?? 20_000);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('Invalid conformance timeout.');
const runnerPath = '/third_party/cts/sdk/tests/webgl-conformance-tests.html';
const results: CaseResult[] = [];
const inventory: string[] = [];
const progress = { activeIndex: null as number | null, finished: 0, running: false,
  activeAssertions: 0, activity: 0, lastActivityAt: performance.now() };
let harness: OfficialHarness | null = null;
let current: ActiveCase | null = null;
let inventoryReady = false;
let readyResolve!: (value: string[]) => void;
let readyReject!: (error: unknown) => void;
const readyPromise = new Promise<string[]>((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});
// Readiness rejection is also observable through ready(), without a global promise error.
void readyPromise.catch(() => {});

function scope(factory: PreparedContextFactory | null = null): Scope {
  return { factory, workers: [], canvases: new WeakMap(), contexts: [], seenContexts: new WeakSet(), errors: [], adapterGaps: [], realmTransfers: 0 };
}
const probe = scope();

function activity(): void {
  progress.activity++;
  progress.lastActivityAt = performance.now();
}

function event(value: Record<string, unknown>): void {
  const callback = Reflect.get(window, '__refralConformanceEvent') as
    ((value: Record<string, unknown>) => Promise<unknown> | void) | undefined;
  if (callback) void Promise.resolve(callback(value)).catch(() => {});
}

function isRunner(url: string): boolean {
  return new URL(url, location.href).pathname === runnerPath;
}

function selectedScope(url: string): Scope | null {
  return isRunner(url) ? probe : current;
}

function diagnostic(reason: unknown, kind: string, url: string): ConformanceDiagnostic {
  const value = reason && typeof reason === 'object' ? reason as { name?: unknown; message?: unknown } : null;
  return { kind, name: typeof value?.name === 'string' ? value.name : 'Error',
    message: typeof value?.message === 'string' ? value.message : String(reason), url };
}

function addError(target: Scope, value: ConformanceDiagnostic): void {
  if (!target.errors.some(error => error.kind === value.kind && error.name === value.name
    && error.message === value.message && error.url === value.url)) target.errors.push(value);
  activity();
}

function routeError(value: ConformanceDiagnostic): void {
  if (value.frameUrl) {
    const testsBase = new URL('/third_party/cts/sdk/tests/', location.href);
    const framePath = new URL(value.frameUrl, testsBase).pathname;
    const activePath = current ? new URL(current.url, testsBase).pathname : null;
    if (framePath !== activePath) {
      const completed = results.find(result => new URL(result.url, testsBase).pathname === framePath);
      if (completed) {
        const late = completed.lateDiagnostics ??= [];
        if (!late.some(error => error.kind === value.kind && error.name === value.name
          && error.message === value.message && error.url === value.url)) {
          late.push(value);
          event({ type: 'late-diagnostic', index: completed.index, url: completed.url, diagnostic: value });
        }
        activity();
        return;
      }
    }
  }
  const target = selectedScope(value.frameUrl ?? value.url) ?? probe;
  addError(target, value);
  const active = current;
  if (abortUnsupported && active && target === active && active.phase === 'running'
    && active.capabilityTimer === null && value.name === 'NotSupportedError'
    && (value.kind === 'page' || value.kind === 'promise')) {
    const instance = harness;
    active.capabilityTimer = setTimeout(() => {
      active.capabilityTimer = null;
      if (!instance || current !== active || active.phase !== 'running') return;
      const test = instance.runningTests[active.url];
      if (!test) return;
      active.capabilityTerminated = true;
      instance.timeout(test);
    }, 100);
  }
}

function addGap(target: Scope, value: ConformanceGap): void {
  if (!target.adapterGaps.some(gap => gap.kind === value.kind && gap.message === value.message
    && gap.url === value.url)) target.adapterGaps.push(value);
  activity();
}

function captureContext(target: Scope, context: WebGLRenderingContext, kind: string,
  url: string, surface: CanvasSurface): void {
  if (target.seenContexts.has(context)) return;
  target.seenContexts.add(context);
  let actualCore: ConformanceBackend = 'native';
  let adapter: Record<string, unknown> = {};
  const hooks = backend === 'native' ? null : getTestingHooks(context);
  if (hooks) {
    actualCore = hooks.core;
    adapter = hooks.environment.adapter as Record<string, unknown>;
    if (actualCore !== backend) addError(target, { kind: 'core-selection', name: 'CoreSelectionError',
      message: `Requested ${backend}, received ${actualCore}.`, url });
    void hooks.device.lost.then(info => {
      if (info.reason !== 'destroyed') addError(target, { kind: 'gpu-device', name: 'GPUDeviceLost',
        message: info.message, url });
    });
  }
  target.contexts.push({ ...(hooks ? { selected: new WeakRef(context), device: hooks.device, errors: hooks.errors } : { native: context }),
    record: { requestedCore: backend, actualCore, surface, kind, attributes: context.getContextAttributes(), adapter, url } });
  activity();
}

async function finalizeResources(target: Scope, url: string, beforeDispose?: () => Promise<void>): Promise<void> {
  await Promise.all(target.workers.map(async worker => {
    if (worker.exit) return;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      // A discarded child document can no longer settle its own timers or promises.
      await Promise.race([worker.finish(), new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`Worker finalization timed out: ${worker.script}`)), 3000);
      })]);
    } catch (error) { addError(target, diagnostic(error, 'worker-finalization', url)); }
    finally { clearTimeout(deadline); }
    if (!worker.ready && !worker.exit) addGap(target, { kind: 'worker-webgl-provenance', url,
      message: `Worker did not acknowledge execution of its original entry: ${worker.script}` });
  }));
  if (backend === 'native') {
    for (const { native: context, record } of target.contexts) {
      if (!context) continue;
      try {
        const debug = context.getExtension('WEBGL_debug_renderer_info');
        record.adapter = { version: context.getParameter(context.VERSION),
          renderer: context.getParameter(context.RENDERER), vendor: context.getParameter(context.VENDOR),
          unmaskedRenderer: debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
          unmaskedVendor: debug ? context.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null };
        // Official iframe navigation and browser-context rotation release native resources.
        // Forcing context loss here would re-enter the completed test's event listeners.
      } catch (error) { addError(target, diagnostic(error, 'context-finalization', url)); }
    }
    await beforeDispose?.();
    return;
  }
  for (const entry of target.contexts) {
    try {
      entry.selected?.deref()?.flush();
      await entry.device?.queue.onSubmittedWorkDone();
    } catch (error) { addError(target, diagnostic(error, 'gpu-completion', url)); }
  }
  // Allow queued uncaptured validation diagnostics to arrive before disposal.
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const entry of target.contexts) {
    for (const message of entry.errors ?? []) {
      addError(target, { kind: 'gpu-validation', name: 'GPUValidationError', message, url });
    }
  }
  await beforeDispose?.();
  try { await target.factory?.dispose(); }
  catch (error) { addError(target, diagnostic(error, 'factory-disposal', url)); }
  target.factory = null;
}

function status(value: ActiveCase, completion: CaseResult['completion']): CaseResult['status'] {
  if (completion === 'capability-error') return 'unsupported';
  if (completion === 'timeout' || value.assertionTimeouts) return 'timeout';
  if (value.adapterGaps.length || value.errors.some(error => error.name === 'NotSupportedError')) return 'unsupported';
  if (value.errors.some(error => error.kind !== 'resource')) return 'harness-error';
  if (value.failed - value.skippedFailures > 0) return 'fail';
  if (value.passed) return 'pass';
  return value.skipped ? 'skip' : 'harness-error';
}

async function finishCase(instance: OfficialHarness, original: (argument: never) => void,
  argument: string | OfficialTest, completion: CaseResult['completion']): Promise<void> {
  const active = current;
  if (!active || active.phase !== 'running') return;
  active.phase = 'finalizing';
  if (active.capabilityTimer !== null) clearTimeout(active.capabilityTimer);
  active.capabilityTimer = null;
  if (active.capabilityTerminated) completion = 'capability-error';
  const test = typeof argument === 'string'
    ? instance.runningTests[active.url] : argument;
  if (test) instance.clearTimeout(test);
  const capture = Reflect.get(window, '__refralConformanceCapture') as
    ((request: { index: number; url: string }) => Promise<CaseScreenshot>) | undefined;
  let screenshot: CaseScreenshot | undefined;
  let captureDuration = 0;
  const beforeDispose = capture && (async () => {
    const started = performance.now();
    try { screenshot = await capture({ index: active.index, url: active.url }); }
    catch (error) { screenshot = { kind: 'unavailable', message: String(error) }; }
    captureDuration = performance.now() - started;
  });
  try { await finalizeResources(active, active.url, beforeDispose); }
  catch (error) { addError(active, diagnostic(error, 'finalization', active.url)); }
  const result: CaseResult = { index: active.index, url: active.url, backend,
    status: status(active, completion), completion, capabilityTerminated: active.capabilityTerminated,
    upstreamCompleted: completion === 'finished', passed: active.passed, failed: active.failed,
    skipped: active.skipped, skippedFailures: active.skippedFailures,
    assertionTimeouts: active.assertionTimeouts,
    failures: active.failures.slice(), failuresTruncated: active.failuresTruncated,
    errors: active.errors.slice(), contexts: [...active.contexts.map(entry => entry.record), ...active.workers.flatMap(worker => worker.contexts)],
    collectedWindowContexts: active.contexts.filter(entry => entry.selected && !entry.selected.deref()).length,
    ...(active.workers.length ? { workers: active.workers.map(({ script, depth, ready, exit, contexts }) =>
      ({ script, depth, ready, ...(exit ? { exit } : {}), contexts: contexts.length })) } : {}),
    adapterGaps: active.adapterGaps.slice(), durationMs: performance.now() - active.started - captureDuration,
    realmTransfers: active.realmTransfers, ...(screenshot ? { screenshot } : {}) };
  results.push(result);
  progress.finished++;
  progress.activeIndex = null;
  progress.activeAssertions = 0;
  current = null;
  activity();
  event({ type: 'finish', result });
  // Original counts and classification are fixed before this call can start the next file.
  Reflect.apply(original, instance, [argument]);
}

async function startCase(instance: OfficialHarness, original: OfficialHarness['startTest'],
  iframe: HTMLIFrameElement, file: OfficialFile, version: number): Promise<void> {
  const active: ActiveCase = { ...scope(), index: instance.files.indexOf(file), url: file.url,
    started: performance.now(), phase: 'running', passed: 0, failed: 0, skipped: 0,
    skippedFailures: 0, assertionTimeouts: 0,
    failures: [], failuresTruncated: 0, capabilityTerminated: false, capabilityTimer: null };
  current = active;
  progress.activeIndex = active.index;
  progress.activeAssertions = 0;
  activity();
  event({ type: 'start', index: active.index, url: active.url });
  try {
    active.factory = backend === 'native' ? null : await prepareContextFactory({ core: backend });
    Reflect.apply(original, instance, [iframe, file, version]);
  } catch (error) {
    addError(active, diagnostic(error, 'test-initialization', file.url));
    // Preserve upstream dequeue/scheduling without navigating a file whose factory failed.
    instance.runningTests[file.url] ??= { iframe, testFile: file };
    instance.notifyFinished(file.url);
  }
}

const report: OfficialReport = (type, _url, message, success, skipped) => {
  activity();
  if (type === 1) inventory.push(String(message));
  if (type === 2) {
    inventoryReady = true;
    if (harness) readyResolve(inventory.slice());
  }
  if (type === 4 && current?.phase === 'running') {
    // Match the original Page.addResult counters, including failed/skipped overlap.
    if (success === undefined) current.assertionTimeouts++;
    else if (success) current.passed++;
    else {
      current.failed++;
      if (skipped) { current.skipped++; current.skippedFailures++; }
      if (current.failures.length < 200) current.failures.push(String(message));
      else current.failuresTruncated++;
    }
    progress.activeAssertions = current.passed + current.failed + current.assertionTimeouts;
  }
  if (type === 6) {
    progress.running = false;
    if (!inventoryReady) readyReject(new Error(String(message || 'Official inventory failed to load.')));
  }
};

const bridge: ConformanceBridge = {
  acquire(canvas, kind, attributes, url, surface, binding) {
    const target = selectedScope(url);
    if (!target || !target.factory) throw new DOMException('Selected test factory is unavailable.', 'NotSupportedError');
    const existing = target.canvases.get(canvas);
    if (existing) return kind === 'webgl2' ? null : existing;
    if (kind === 'webgl2') {
      addGap(target, { kind: 'webgl2-context', message: 'The selected core exposes the WebGL1 profile.', url });
      throw new DOMException('Selected-core WebGL2 acquisition is unavailable.', 'NotSupportedError');
    }
    let context: WebGLRenderingContext;
    try { context = target.factory(canvas, attributes, binding); }
    catch (error) {
      const detail = error as { name?: unknown; message?: unknown } | null;
      if (detail?.name === 'InvalidStateError'
        && detail.message === 'Canvas is already bound to another context') return null;
      throw error;
    }
    target.canvases.set(canvas, context);
    captureContext(target, context, kind, url, surface);
    return context;
  },
  context(context, kind, _attributes, url, surface) {
    const target = selectedScope(url);
    if (target) captureContext(target, context, kind, url, surface);
  },
  worker(url, script, finish) {
    const target = selectedScope(url);
    if (!target) throw new Error('Missing scope for official worker.');
    function observeWorker(scriptURL: string, depth: number, finishWorker: () => Promise<void>) {
      const worker: Scope['workers'][number] = { script: scriptURL, depth, ready: false, contexts: [] as ContextRecord[], finish: finishWorker };
      const nested = new Map<number, (event: WorkerObservation) => void>();
      target!.workers.push(worker);
      return (event: WorkerObservation) => {
        if (event.type === 'ready') worker.ready = true;
        else if (event.type === 'exit') worker.exit ??= event.reason;
        else if (event.type === 'nested') {
          let observer = nested.get(event.id);
          if (!observer) {
            // Its parent worker drains the child before acknowledging its own finish.
            observer = observeWorker(event.script, depth + 1, async () => {});
            nested.set(event.id, observer);
          }
          if (event.event) observer(event.event);
        } else if (event.type === 'error') {
          addError(target!, { kind: 'worker', name: event.name ?? 'WorkerError', message: event.message, url });
        } else if (event.type === 'gap') addGap(target!, { kind: 'worker-webgl-provenance', message: event.message, url });
        else if (event.type === 'context') {
          if (event.context.actualCore !== backend) addError(target!, { kind: 'core-selection', name: 'CoreSelectionError',
            message: `Worker requested ${backend}, received ${event.context.actualCore}.`, url });
          worker.contexts.push({ ...event.context, requestedCore: backend, realm: 'dedicated-worker',
            surface: 'offscreen-canvas', url: scriptURL });
        }
        activity();
      };
    }
    return observeWorker(script, 1, finish);
  },
  error: routeError,
  gap(value) { addGap(selectedScope(value.url) ?? probe, value); },
  realmTransfer(url) {
    const target = selectedScope(url);
    if (target) target.realmTransfers++;
  },
  attach(instance) {
    harness = instance;
    harness.setTimeoutDelay(timeoutMs);
    if (inventoryReady) readyResolve(inventory.slice());
  },
  report,
  start(instance, original, iframe, file, version) {
    void startCase(instance, original, iframe, file, version);
  },
  finish(instance, original, argument, completion) {
    void finishCase(instance, original, argument, completion).catch(error => {
      addError(probe, diagnostic(error, 'harness-callback', location.href));
      progress.running = false;
    });
  },
};

const session = { ready: () => readyPromise, inventory, results, progress,
  backend, timeoutMs, abortUnsupported, probeContexts: probe.contexts, errors: probe.errors,
  run(options: { start: number; count: number }) {
    if (!harness || !inventoryReady) throw new Error('Official conformance inventory is still loading.');
    if (progress.running) throw new Error('An official conformance run is already active.');
    if (!Number.isInteger(options.start) || !Number.isInteger(options.count) || options.start < 0
      || options.count <= 0 || options.start + options.count > inventory.length) {
      throw new RangeError('Invalid official conformance range.');
    }
    results.length = 0;
    progress.finished = 0;
    progress.running = true;
    activity();
    harness.runTests({ ...options });
  } };
Reflect.set(window, '__refralConformanceBridge', bridge);
Reflect.set(window, 'conformanceSession', session);

window.addEventListener('pagehide', () => {
  void current?.factory?.dispose();
  void probe.factory?.dispose();
});

try {
  const installedBackend = Reflect.get(window, '__refralConformanceInitBackend');
  if (installedBackend !== backend) {
    throw new Error(`Official conformance requires a matching document-start bootstrap. Requested ${backend}, observed ${installedBackend ?? 'missing'}.`);
  }
  probe.factory = backend === 'native' ? null : await prepareContextFactory({ core: backend });
  const iframe = document.createElement('iframe');
  iframe.title = 'Official WebGL conformance runner';
  iframe.style.width = '100%';
  iframe.style.height = '90vh';
  // Omit fast entirely. The original parser treats a nonempty "false" value as enabled.
  iframe.src = `${runnerPath}?version=1.0.4&frames=1&quiet=1`;
  document.body.appendChild(iframe);
} catch (error) {
  addError(probe, diagnostic(error, 'runner-initialization', location.href));
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = diagnostic(error, 'runner-initialization', location.href).message;
  document.body.appendChild(message);
  readyReject(error);
}

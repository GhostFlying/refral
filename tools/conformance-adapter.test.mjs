import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { installConformanceBridge } from '../tests/fixtures/conformance-init.ts';

function fixture(backend = 'js', options = {}) {
  const canvasBrands = new WeakSet();
  const offscreenBrands = new WeakSet();
  const selected = new WeakMap();
  const calls = { native: [], acquire: [], contexts: [], errors: [], gaps: [], realmTransfers: [] };
  const nativeString = String;

  function width(receiver, brands, label) {
    if (!brands.has(receiver)) throw new TypeError(`native ${label} receiver`);
    return 16;
  }

  function nativeGetContext(receiver, brands, label, args) {
    width(receiver, brands, label);
    if (args.length === 0) throw new TypeError(`native ${label} contextId required`);
    if (typeof args[0] === 'symbol') throw new TypeError(`native ${label} symbol`);
    const kind = nativeString(args[0]);
    calls.native.push({ label, receiver, kind });
    return ['webgl', 'experimental-webgl', 'webgl2', '2d', 'bitmaprenderer', 'webgpu'].includes(kind)
      ? options.nativeContext ?? { native: true, kind } : null;
  }

  class Canvas {
    constructor() { canvasBrands.add(this); }
    get width() { return width(this, canvasBrands, 'html'); }
    getContext(...args) { return nativeGetContext(this, canvasBrands, 'html', args); }
  }
  class Offscreen {
    constructor() { offscreenBrands.add(this); }
    get width() { return width(this, offscreenBrands, 'offscreen'); }
    getContext(...args) { return nativeGetContext(this, offscreenBrands, 'offscreen', args); }
  }
  const bridge = {
    acquire(canvas, kind) {
      calls.acquire.push({ canvas, kind });
      let context = selected.get(canvas);
      if (!context) { context = options.context ?? { actualCore: backend }; selected.set(canvas, context); }
      return kind === 'webgl2' ? null : context;
    },
    context(context, kind) { calls.contexts.push({ context, kind }); },
    error(value) { calls.errors.push(value); },
    gap(value) { calls.gaps.push(value); },
    realmTransfer(url) { calls.realmTransfers.push(url); },
  };
  const scope = {
    console: { error() {} }, DOMException, URL,
    location: { pathname: options.pathname ?? '/third_party/cts/sdk/tests/conformance/context/canvas.html',
      href: `http://localhost${options.pathname ?? '/third_party/cts/sdk/tests/conformance/context/canvas.html'}` },
    HTMLCanvasElement: Canvas, WebGLRenderingContext: class {}, OffscreenCanvas: Offscreen,
    Element: class {}, addEventListener() {},
    ...(options.bridge === false ? {} : { __refralConformanceBridge: bridge }),
  };
  scope.window = scope;
  scope.parent = scope;
  vm.createContext(scope);
  vm.runInContext(`(${installConformanceBridge.toString()})(${JSON.stringify({ backend })});`, scope);
  return { Canvas, Offscreen, scope, calls, canvasBrands };
}

for (const backend of ['js', 'rust']) {
  test(`${backend} routes boxed and coercible context IDs through the selected core`, () => {
    const { Canvas, calls } = fixture(backend);
    for (const id of [new String('webgl'), { toString: () => 'webgl' },
      new String('experimental-webgl'), { [Symbol.toPrimitive]: () => 'experimental-webgl' }]) {
      assert.equal(new Canvas().getContext(id).actualCore, backend);
    }
    assert.deepEqual(calls.acquire.map(value => value.kind),
      ['webgl', 'webgl', 'experimental-webgl', 'experimental-webgl']);
    assert.equal(calls.native.length, 0);
    assert.equal(calls.errors.length, 0);
  });

  test(`${backend} converts the context ID once with the string hint`, () => {
    const { Canvas, calls } = fixture(backend);
    let count = 0;
    const context = new Canvas().getContext({ [Symbol.toPrimitive](hint) {
      assert.equal(hint, 'string');
      assert.equal(++count, 1);
      return 'webgl';
    } });
    assert.equal(count, 1);
    assert.equal(context.actualCore, backend);
    assert.equal(calls.acquire.length, 1);
    assert.equal(calls.native.length, 0);
  });

  test(`${backend} normalizes non-WebGL IDs before enforcing the selected canvas slot`, () => {
    const { Canvas, calls } = fixture(backend);
    const canvas = new Canvas();
    const context = canvas.getContext('webgl');
    assert.equal(canvas.getContext(new String('experimental-webgl')), context);
    for (const kind of ['2d', 'bitmaprenderer', 'webgpu']) {
      let conversions = 0;
      assert.equal(canvas.getContext({ toString() { conversions++; return kind; } }), null);
      assert.equal(conversions, 1);
    }
    assert.equal(canvas.getContext(new String('webgl2')), null);
    assert.equal(calls.native.length, 0);
  });

  test(`${backend} blocks coercible Offscreen WebGL IDs before native acquisition`, () => {
    const { Offscreen, calls } = fixture(backend);
    for (const kind of ['webgl', 'experimental-webgl', 'webgl2']) {
      let conversions = 0;
      assert.throws(() => new Offscreen().getContext({ toString() { conversions++; return kind; } }),
        { name: 'NotSupportedError' });
      assert.equal(conversions, 1);
    }
    assert.equal(calls.gaps.length, 3);
    assert.equal(calls.native.length, 0);
    assert.equal(calls.acquire.length, 0);
  });
}

for (const [constructorName, label] of [['Canvas', 'html'], ['Offscreen', 'offscreen']]) {
  test(`${label} validates its receiver before context ID coercion`, () => {
    const setup = fixture();
    const Constructor = setup[constructorName];
    const getContext = Constructor.prototype.getContext;
    let conversions = 0;
    const id = { toString() { conversions++; return 'webgl'; } };
    for (const receiver of [{}, null, undefined]) {
      assert.throws(() => getContext.call(receiver, id), { name: 'TypeError', message: `native ${label} receiver` });
    }
    assert.equal(conversions, 0);
    assert.equal(setup.calls.acquire.length, 0);
    assert.equal(setup.calls.native.length, 0);
    assert.equal(setup.calls.errors.length, 0);
  });

  test(`${label} preserves native required-argument and Symbol errors`, () => {
    const setup = fixture();
    const canvas = new setup[constructorName]();
    assert.throws(() => canvas.getContext(), { name: 'TypeError', message: `native ${label} contextId required` });
    assert.throws(() => canvas.getContext(Symbol('webgl')), { name: 'TypeError', message: `native ${label} symbol` });
    assert.throws(() => canvas.getContext({ [Symbol.toPrimitive]: () => Symbol('webgl') }), { name: 'TypeError' });
    assert.equal(setup.calls.native.length, 0);
    assert.equal(setup.calls.acquire.length, 0);
    assert.equal(setup.calls.gaps.length, 0);
    assert.equal(setup.calls.errors.length, 0);
  });

  test(`${label} preserves conversion exceptions and bypasses shadowed width properties`, () => {
    const setup = fixture();
    const canvas = new setup[constructorName]();
    const failure = new Error('context ID conversion failed');
    Object.defineProperty(canvas, 'width', { get() { throw new Error('shadowed width was read'); } });
    assert.throws(() => canvas.getContext({ toString() { throw failure; } }), error => error === failure);
    assert.equal(setup.calls.errors.length, 0);
    assert.equal(canvas.getContext({ toString: () => '2d' }).kind, '2d');
  });
}

test('native HTMLCanvas acquisition normalizes once and retains original context tracking', () => {
  const { Canvas, calls } = fixture('native');
  let conversions = 0;
  const context = new Canvas().getContext({ toString() { conversions++; return 'webgl'; } });
  assert.equal(conversions, 1);
  assert.equal(context.native, true);
  assert.equal(calls.contexts.length, 1);
  assert.equal(calls.contexts[0].context, context);
  assert.equal(calls.contexts[0].kind, 'webgl');
  assert.equal(calls.native.length, 1);
  assert.equal(calls.native[0].kind, 'webgl');
  assert.equal(calls.acquire.length, 0);
});

test('explicit undefined is converted while an absent argument remains an error', () => {
  const { Canvas, calls } = fixture();
  assert.equal(new Canvas().getContext(undefined), null);
  assert.equal(calls.native[0].kind, 'undefined');
  assert.throws(() => new Canvas().getContext(), { name: 'TypeError' });
});

test('selected realm branding does not expose native getters, setters or methods on the facade', () => {
  const raw = { actualCore: 'js' };
  const { Canvas, scope } = fixture('js', { context: raw });
  const nativePrototype = scope.WebGLRenderingContext.prototype;
  Object.defineProperty(nativePrototype, 'unpackColorSpace', {
    get() { throw new Error('native getter executed'); },
    set() { throw new Error('native setter executed'); },
  });
  nativePrototype.nativeOnly = () => {};
  const context = new Canvas().getContext('webgl');
  assert.ok(context instanceof scope.WebGLRenderingContext);
  assert.equal(Object.getPrototypeOf(raw), Object.prototype);
  assert.equal('unpackColorSpace' in context, false);
  assert.equal(context.unpackColorSpace, undefined);
  assert.equal(context.nativeOnly, undefined);
  context.unpackColorSpace = 'srgb';
  assert.equal(raw.unpackColorSpace, 'srgb');
});

test('intrinsic brand checks accept a genuine canvas from another realm', () => {
  const { Canvas, calls, canvasBrands } = fixture();
  const foreign = vm.runInNewContext('new (class ForeignCanvas {})()');
  canvasBrands.add(foreign);
  assert.equal(foreign instanceof Canvas, false);
  assert.equal(Canvas.prototype.getContext.call(foreign, new String('webgl')).actualCore, 'js');
  assert.equal(calls.acquire.length, 1);
  assert.equal(calls.native.length, 0);
});

test('selected context IDs cannot fall through to native WebGL when the bridge is absent', () => {
  const { Canvas, calls } = fixture('js', { bridge: false });
  assert.throws(() => new Canvas().getContext({ toString: () => 'webgl' }), { name: 'NotSupportedError' });
  assert.equal(calls.native.length, 0);
});

test('context ID conversion uses the captured intrinsic String function', () => {
  const { Canvas, scope, calls } = fixture();
  scope.String = () => { throw new Error('overridden global String was invoked'); };
  assert.equal(new Canvas().getContext({ toString: () => 'webgl' }).actualCore, 'js');
  assert.equal(calls.native.length, 0);
});

test('the parent wrapper receives the bootstrap marker while its Canvas remains native', () => {
  const { Canvas, scope, calls } = fixture('rust', { pathname: '/tests/fixtures/conformance.html' });
  assert.equal(scope.__refralConformanceInitBackend, 'rust');
  assert.equal(new Canvas().getContext(new String('webgl')).native, true);
  assert.equal(calls.acquire.length, 0);
  assert.equal(calls.contexts.length, 0);
});

async function nativeSession(options = {}) {
  const source = stripTypeScriptTypes(readFileSync(new URL('../tests/fixtures/conformance.ts', import.meta.url), 'utf8'))
    .replace(/^import[^;]*;\s*/gm, '');
  const events = [];
  const backend = options.backend ?? 'native';
  const search = `?backend=${backend}${options.abortUnsupported ? '&abortUnsupported=1' : ''}`;
  let now = 1;
  let timerId = 0;
  const timers = new Map();
  const timeoutCalls = [];
  const scope = {
    console, URL, URLSearchParams,
    setTimeout(callback, delay) { timers.set(++timerId, { callback, at: now + delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    performance: { now: () => now },
    location: { href: `http://localhost/tests/fixtures/conformance.html${search}`, search },
    document: { createElement: () => ({ style: {}, setAttribute() {} }), body: { appendChild() {} } },
    addEventListener() {}, __refralConformanceInitBackend: backend,
    __refralConformanceEvent: value => events.push(value),
    prepareContextFactory: async () => Object.assign(() => {}, { dispose: async () => {} }),
  };
  scope.window = scope;
  vm.createContext(scope);
  await vm.runInContext(`(async () => {${source}\n})()`, scope);
  const bridge = scope.__refralConformanceBridge;
  const files = [{ url: 'conformance/context/previous.html' }, { url: 'conformance/context/current.html' }];
  const harness = { files, runningTests: {}, setTimeoutDelay() {}, clearTimeout() {},
    timeout(test) {
      bridge.finish(this, function(value) {
        timeoutCalls.push(value.testFile.url);
        delete this.runningTests[value.testFile.url];
      }, test, 'timeout');
    } };
  bridge.attach(harness);
  async function tick(milliseconds) {
    await Promise.resolve();
    now += milliseconds;
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= now)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      timers.delete(due[0]);
      due[1].callback();
      await Promise.resolve();
    }
    await new Promise(resolve => setImmediate(resolve));
  }
  function start(index) {
    bridge.start(harness, function(iframe, file) {
      this.runningTests[file.url] = { iframe, testFile: file };
    }, {}, files[index], 1);
    bridge.report(4, files[index].url, 'original positive assertion', true, false);
  }
  async function finish(index) {
    bridge.finish(harness, function(url) { delete this.runningTests[url]; }, files[index].url, 'finished');
    await tick(0);
  }
  return { scope, bridge, files, start, finish, events, tick, timeoutCalls };
}

test('native conformance finalization collects metadata without synthesizing context loss', async () => {
  const setup = await nativeSession();
  const extensions = [];
  const context = { getContextAttributes: () => ({ alpha: true }), getParameter: () => 'native metadata',
    getExtension(name) {
      extensions.push(name);
      if (name === 'WEBGL_lose_context') throw new Error('Completed test listeners would run again.');
      return null;
    } };
  setup.start(0);
  setup.bridge.context(context, 'webgl', undefined,
    `http://localhost/third_party/cts/sdk/tests/${setup.files[0].url}`);
  await setup.finish(0);
  const [result] = setup.scope.conformanceSession.results;
  assert.equal(result.status, 'pass');
  assert.equal(result.errors.length, 0);
  assert.deepEqual(extensions, ['WEBGL_debug_renderer_info']);
});

test('previous-frame diagnostics stay with the completed result while active-frame errors remain active', async () => {
  const setup = await nativeSession();
  setup.start(0);
  await setup.finish(0);
  setup.start(1);
  const previous = { kind: 'page', name: 'Error', message: 'late previous callback',
    url: 'http://localhost/third_party/cts/sdk/tests/js/webgl-test-harness.js',
    frameUrl: `http://localhost/third_party/cts/sdk/tests/${setup.files[0].url}?webglVersion=1` };
  setup.bridge.error(previous);
  setup.bridge.error(previous);
  const active = { ...previous, message: 'active callback failed',
    frameUrl: `http://localhost/third_party/cts/sdk/tests/${setup.files[1].url}?webglVersion=1` };
  setup.bridge.error(active);
  await setup.finish(1);
  const [completed, current] = setup.scope.conformanceSession.results;
  assert.equal(completed.status, 'pass');
  assert.equal(completed.errors.length, 0);
  assert.equal(completed.lateDiagnostics.length, 1);
  assert.equal(completed.lateDiagnostics[0].message, previous.message);
  assert.equal(current.status, 'harness-error');
  assert.equal(current.errors.length, 1);
  assert.equal(current.errors[0].message, active.message);
  assert.equal(setup.events.filter(value => value.type === 'late-diagnostic').length, 1);
});

for (const backend of ['js', 'rust']) {
  test(`${backend} materializes getter containers with child intrinsics and retains resource identity`, () => {
    const buffer = new ArrayBuffer(24);
    new Uint32Array(buffer, 4, 3).set([0x80000000, 0x7fa12345, 0x3fa00000]);
    const floats = new Float32Array(buffer, 4, 3);
    const originalBytes = new Uint8Array(buffer, 4, 12).slice();
    // User-visible shadows must not alter the brand or bytes selected by intrinsic getters.
    Object.defineProperties(floats, {
      buffer: { get() { throw new Error('shadow buffer getter'); } },
      byteOffset: { get() { throw new Error('shadow offset getter'); } },
      byteLength: { get() { throw new Error('shadow byte-length getter'); } },
      length: { get() { throw new Error('shadow length getter'); } },
      [Symbol.toStringTag]: { value: 'Int32Array' },
    });
    const booleans = [true, false, true, false];
    const shader = Object.create({ resourceType: 'shader' });
    const program = Object.create({ resourceType: 'program' });
    const shaderPrototype = Object.getPrototypeOf(shader);
    const integers = new Int32Array([1, -2, 3]);
    const extensions = ['EXAMPLE_extension'];
    const raw = {
      getParameter: name => name === 'mask' ? booleans : name === 'program' ? program : floats,
      getVertexAttrib: () => floats,
      getUniform: () => integers,
      getAttachedShaders: () => [shader],
      getSupportedExtensions: () => extensions,
      getError: () => 0,
    };
    const { Canvas, scope, calls } = fixture(backend, { context: raw });
    const ChildFloat32Array = vm.runInContext('Float32Array', scope);
    const ChildInt32Array = vm.runInContext('Int32Array', scope);
    const ChildArray = vm.runInContext('Array', scope);
    const canvas = new Canvas();
    const gl = canvas.getContext('webgl');
    assert.notEqual(gl, raw);
    assert.equal(canvas.getContext('experimental-webgl'), gl);
    assert.equal(gl.getParameter, gl.getParameter);
    assert.equal(gl.getError, raw.getError);
    for (const value of [gl.getParameter('float'), gl.getVertexAttrib(0, 0)]) {
      assert.equal(value instanceof ChildFloat32Array, true);
      assert.equal(value instanceof Float32Array, false);
      assert.deepEqual(new Uint8Array(value.buffer), originalBytes);
      assert.equal(Object.is(value[0], -0), true);
      assert.equal(Number.isNaN(value[1]), true);
      assert.equal(value[2], 1.25);
    }
    const boolResult = gl.getParameter('mask');
    assert.equal(boolResult instanceof ChildArray, true);
    assert.deepEqual(Array.from(boolResult), booleans);
    assert.notEqual(boolResult, booleans);
    const uniformResult = gl.getUniform(program, null);
    assert.equal(uniformResult instanceof ChildInt32Array, true);
    assert.deepEqual(Array.from(uniformResult), [1, -2, 3]);
    const attached = gl.getAttachedShaders(program);
    assert.equal(attached instanceof ChildArray, true);
    assert.equal(attached[0], shader);
    assert.equal(Object.getPrototypeOf(shader), shaderPrototype);
    assert.equal(gl.getParameter('program'), program);
    assert.equal(gl.getSupportedExtensions() instanceof ChildArray, true);
    assert.equal(calls.realmTransfers.length, 6);
    assert.equal(calls.native.length, 0);
  });
}

test('realm getter adaptation propagates the original exception object', () => {
  const failure = new Error('original getter failed');
  const { Canvas, calls } = fixture('js', { context: { getUniform() { throw failure; } } });
  assert.throws(() => new Canvas().getContext('webgl').getUniform(null, null), error => error === failure);
  assert.equal(calls.realmTransfers.length, 0);
  assert.equal(calls.errors.length, 0);
});

test('realm getter adaptation uses constructors captured before test mutation', () => {
  const { Canvas, scope } = fixture('js', {
    context: { getVertexAttrib: () => new Float32Array([1, 2]), getSupportedExtensions: () => ['EXT'] },
  });
  const ChildFloat32Array = vm.runInContext('Float32Array', scope);
  const ChildArray = vm.runInContext('Array', scope);
  for (const key of ['Float32Array', 'Uint8Array', 'Array']) {
    scope[key] = () => { throw new Error(`mutated constructor ${key}`); };
  }
  const gl = new Canvas().getContext('webgl');
  assert.equal(gl.getVertexAttrib(0, 0) instanceof ChildFloat32Array, true);
  assert.equal(gl.getSupportedExtensions() instanceof ChildArray, true);
});

test('native getter results retain their original identity and realm', () => {
  const floats = new Float32Array([1, 2, 3]);
  const values = [true, false];
  const raw = { getVertexAttrib: () => floats, getParameter: () => values };
  const { Canvas, calls } = fixture('native', { nativeContext: raw });
  const gl = new Canvas().getContext('webgl');
  assert.equal(gl, raw);
  assert.equal(gl.getVertexAttrib(0, 0), floats);
  assert.equal(gl.getParameter(0), values);
  assert.equal(calls.realmTransfers.length, 0);
});

for (const backend of ['js', 'rust']) {
  for (const kind of ['page', 'promise']) {
    test(`${backend} terminates an uncaught ${kind} capability barrier after its grace period`, async () => {
      const setup = await nativeSession({ backend, abortUnsupported: true });
      setup.start(0);
      setup.bridge.report(4, setup.files[0].url, 'original failed assertion', false, false);
      const error = { kind, name: 'NotSupportedError', message: 'TRIANGLE_STRIP is unavailable',
        url: `http://localhost/third_party/cts/sdk/tests/${setup.files[0].url}` };
      setup.bridge.error(error);
      await setup.tick(99);
      assert.equal(setup.scope.conformanceSession.results.length, 0);
      await setup.tick(1);
      const [result] = setup.scope.conformanceSession.results;
      assert.equal(result.status, 'unsupported');
      assert.equal(result.completion, 'capability-error');
      assert.equal(result.capabilityTerminated, true);
      assert.equal(result.upstreamCompleted, false);
      assert.equal(Object.hasOwn(result, 'assertionCountsComplete'), false);
      assert.equal(result.passed, 1);
      assert.equal(result.failed, 1);
      assert.equal(result.skipped, 0);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].message, error.message);
      assert.deepEqual(setup.timeoutCalls, [setup.files[0].url]);
    });
  }
}

test('caught context-acquisition diagnostics do not trigger capability termination', async () => {
  const setup = await nativeSession({ backend: 'js', abortUnsupported: true });
  setup.start(0);
  setup.bridge.error({ kind: 'context-acquisition', name: 'NotSupportedError', message: 'caught acquisition',
    url: `http://localhost/third_party/cts/sdk/tests/${setup.files[0].url}` });
  await setup.tick(1000);
  assert.equal(setup.scope.conformanceSession.results.length, 0);
  assert.deepEqual(setup.timeoutCalls, []);
  await setup.finish(0);
  const [result] = setup.scope.conformanceSession.results;
  assert.equal(result.completion, 'finished');
  assert.equal(result.capabilityTerminated, false);
  assert.equal(result.upstreamCompleted, true);
});

test('normal original completion wins within the capability grace period', async () => {
  const setup = await nativeSession({ backend: 'js', abortUnsupported: true });
  setup.start(0);
  setup.bridge.error({ kind: 'page', name: 'NotSupportedError', message: 'unsupported then completed',
    url: `http://localhost/third_party/cts/sdk/tests/${setup.files[0].url}` });
  await setup.tick(50);
  await setup.finish(0);
  setup.start(1);
  await setup.tick(1000);
  assert.equal(setup.scope.conformanceSession.results.length, 1);
  const [result] = setup.scope.conformanceSession.results;
  assert.equal(result.completion, 'finished');
  assert.equal(result.capabilityTerminated, false);
  assert.equal(result.upstreamCompleted, true);
  assert.deepEqual(setup.timeoutCalls, []);
  await setup.finish(1);
});

test('native retains strict execution even when abortUnsupported is requested', async () => {
  const setup = await nativeSession({ backend: 'native', abortUnsupported: true });
  setup.start(0);
  setup.bridge.error({ kind: 'page', name: 'NotSupportedError', message: 'native unsupported exception',
    url: `http://localhost/third_party/cts/sdk/tests/${setup.files[0].url}` });
  await setup.tick(1000);
  assert.equal(setup.scope.conformanceSession.abortUnsupported, false);
  assert.equal(setup.scope.conformanceSession.results.length, 0);
  assert.deepEqual(setup.timeoutCalls, []);
  await setup.finish(0);
});

test('selected-core capability termination is disabled without the explicit query option', async () => {
  const setup = await nativeSession({ backend: 'rust' });
  setup.start(0);
  setup.bridge.error({ kind: 'promise', name: 'NotSupportedError', message: 'strict selected-core exception',
    url: `http://localhost/third_party/cts/sdk/tests/${setup.files[0].url}` });
  await setup.tick(1000);
  assert.equal(setup.scope.conformanceSession.abortUnsupported, false);
  assert.equal(setup.scope.conformanceSession.results.length, 0);
  assert.deepEqual(setup.timeoutCalls, []);
  await setup.finish(0);
});

test('ordinary uncaught errors and stale previous-frame capability errors retain their ownership', async () => {
  const setup = await nativeSession({ backend: 'js', abortUnsupported: true });
  setup.start(0);
  await setup.tick(0);
  await setup.finish(0);
  setup.start(1);
  setup.bridge.error({ kind: 'page', name: 'NotSupportedError', message: 'late previous unsupported',
    url: 'http://localhost/third_party/cts/sdk/tests/js/helper.js',
    frameUrl: `http://localhost/third_party/cts/sdk/tests/${setup.files[0].url}` });
  setup.bridge.error({ kind: 'page', name: 'TypeError', message: 'ordinary active error',
    url: `http://localhost/third_party/cts/sdk/tests/${setup.files[1].url}` });
  await setup.tick(1000);
  assert.equal(setup.scope.conformanceSession.results.length, 1);
  assert.deepEqual(setup.timeoutCalls, []);
  await setup.finish(1);
  const [, result] = setup.scope.conformanceSession.results;
  assert.equal(result.status, 'harness-error');
  assert.equal(result.capabilityTerminated, false);
});

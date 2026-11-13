import { createWebGLOnWebGPU, getTestingHooks } from '@refral/webgl';
import { GL } from '@refral/core-api';
import { check, createBufferEvidence, runPublicBufferFixture } from './buffer-fixtures';
import type { BufferBackend, BufferEvidence } from './buffer-fixtures';
import { runBufferCoreContract } from './buffer-contract';
import { createJsContractCore } from './js-buffer-factory';
import { createRustBufferCore } from '@refral/core-wasm';

const attributes: WebGLContextAttributes = {
  alpha: false, depth: true, stencil: false, antialias: false,
  premultipliedAlpha: false, preserveDrawingBuffer: true,
};

export async function runBrowserBufferContract(backend: 'js' | 'rust') {
  return runBufferCoreContract(backend === 'js' ? createJsContractCore : createRustBufferCore);
}

async function createContext(backend: BufferBackend) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  document.body.append(canvas);
  const gl = backend === 'native' ? canvas.getContext('webgl', attributes)
    : await createWebGLOnWebGPU(canvas, { version: 1, core: backend, attributes });
  if (!gl) throw new Error(`Could not initialize ${backend} context`);
  const hooks = backend === 'native' ? null : getTestingHooks(gl);
  const nativeEnvironment = () => {
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      version: gl.getParameter(gl.VERSION), renderer: gl.getParameter(gl.RENDERER),
      vendor: gl.getParameter(gl.VENDOR), shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
    };
  };
  const environment = {
    ...(hooks?.environment ?? nativeEnvironment()), attributes: gl.getContextAttributes(),
    width: canvas.width, height: canvas.height, devicePixelRatio: window.devicePixelRatio,
  };
  return {
    canvas, gl, hooks, environment,
    async dispose() {
      if (hooks) await hooks.dispose();
      else if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    },
  };
}

export async function runBrowserBufferFixture(backend: BufferBackend) {
  const context = await createContext(backend);
  const peer = await createContext(backend);
  try {
    const foreign = peer.gl.createBuffer()!;
    peer.gl.bindBuffer(GL.ARRAY_BUFFER, foreign);
    const evidence = runPublicBufferFixture(context.gl, foreign, context.hooks?.inspectBuffer);
    check(evidence, 'foreign remains valid in owning context', peer.gl.isBuffer(foreign), true);
    check(evidence, 'peer error state untouched', peer.gl.getError(), GL.NO_ERROR);
    if (context.hooks) {
      check(evidence, 'selected core matches hook', context.hooks.core, backend);
      check(evidence, 'host validation errors', context.hooks.errors, []);
    }
    return { backend, environment: context.environment, evidence };
  } finally {
    await peer.dispose();
    await context.dispose();
  }
}

export async function runCrossCoreBufferFixture() {
  const js = await createContext('js');
  const rust = await createContext('rust');
  const evidence = createBufferEvidence();
  try {
    const jsBuffer = js.gl.createBuffer()!;
    const rustBuffer = rust.gl.createBuffer()!;
    js.gl.bindBuffer(GL.ARRAY_BUFFER, jsBuffer);
    rust.gl.bindBuffer(GL.ARRAY_BUFFER, rustBuffer);
    for (const [name, own, buffer, foreign] of [
      ['js', js, jsBuffer, rustBuffer], ['rust', rust, rustBuffer, jsBuffer],
    ] as const) {
      check(evidence, `${name}: foreign isBuffer`, own.gl.isBuffer(foreign), false);
      check(evidence, `${name}: foreign isBuffer error`, own.gl.getError(), GL.NO_ERROR);
      own.gl.bindBuffer(GL.ARRAY_BUFFER, foreign);
      check(evidence, `${name}: foreign bind error`, own.gl.getError(), GL.INVALID_OPERATION);
      check(evidence, `${name}: own binding retained`, own.gl.getParameter(GL.ARRAY_BUFFER_BINDING) === buffer, true);
      own.gl.deleteBuffer(foreign);
      check(evidence, `${name}: foreign delete error`, own.gl.getError(), GL.INVALID_OPERATION);
      check(evidence, `${name}: own object remains valid`, own.gl.isBuffer(buffer), true);
      check(evidence, `${name}: foreign inspection returns null`, own.hooks!.inspectBuffer(foreign), null);
      check(evidence, `${name}: inspection has no error`, own.gl.getError(), GL.NO_ERROR);
    }
    return { environments: { js: js.environment, rust: rust.environment }, evidence };
  } finally {
    await js.dispose();
    await rust.dispose();
  }
}

export async function runBufferLossFixture(backend: BufferBackend): Promise<{
  backend: BufferBackend; environment: Record<string, unknown>; evidence: BufferEvidence;
}> {
  const context = await createContext(backend);
  const { canvas, gl, hooks } = context;
  const evidence = createBufferEvidence();
  try {
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(GL.ARRAY_BUFFER, buffer);
    gl.bufferData(GL.ARRAY_BUFFER, new Uint8Array([1, 2]), GL.STATIC_DRAW);
    const lost = new Promise<Event>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${backend} context loss event timed out`)), 10_000);
      canvas.addEventListener('webglcontextlost', event => {
        clearTimeout(timeout);
        event.preventDefault();
        resolve(event);
      }, { once: true });
    });
    if (hooks) hooks.device.destroy();
    else {
      const extension = gl.getExtension('WEBGL_lose_context');
      if (!extension) throw new Error('Native WEBGL_lose_context extension unavailable');
      extension.loseContext();
    }
    const event = await lost;
    check(evidence, 'context loss event cancelable', event.cancelable, true);
    check(evidence, 'isContextLost', gl.isContextLost(), true);
    check(evidence, 'loss error once', gl.getError(), GL.CONTEXT_LOST_WEBGL);
    check(evidence, 'loss error consumed', gl.getError(), GL.NO_ERROR);
    // Current WebGL1 requires nonnull, invalidated public objects during loss.
    // The core contract still returns null internally without allocating storage.
    const createdWhileLost = gl.createBuffer()!;
    const nextWhileLost = gl.createBuffer()!;
    check(evidence, 'lost creation returns wrapper', createdWhileLost !== null, true);
    check(evidence, 'lost creation has fresh identity', createdWhileLost !== nextWhileLost, true);
    check(evidence, 'lost wrapper differs from previous object', createdWhileLost !== buffer, true);
    check(evidence, 'lost wrapper is extensible', Object.isExtensible(createdWhileLost), true);
    const annotated = createdWhileLost as WebGLBuffer & { refralTestTag?: string };
    annotated.refralTestTag = 'created-while-lost';
    check(evidence, 'lost wrapper preserves caller property', annotated.refralTestTag, 'created-while-lost');
    check(evidence, 'lost-created isBuffer false before bind', gl.isBuffer(createdWhileLost), false);
    check(evidence, 'lost isBuffer neutral', gl.isBuffer(buffer), false);
    check(evidence, 'lost binding neutral', gl.getParameter(GL.ARRAY_BUFFER_BINDING), null);
    check(evidence, 'lost buffer query neutral', gl.getBufferParameter(GL.ARRAY_BUFFER, GL.BUFFER_SIZE), null);
    check(evidence, 'lost attributes neutral', gl.getContextAttributes(), null);
    gl.bindBuffer(GL.ARRAY_BUFFER, buffer);
    gl.bufferData(GL.ARRAY_BUFFER, 4, GL.STATIC_DRAW);
    gl.bufferSubData(GL.ARRAY_BUFFER, -1, new Uint8Array([3]));
    gl.deleteBuffer(buffer);
    check(evidence, 'lost mutations have no error', gl.getError(), GL.NO_ERROR);
    gl.bindBuffer(GL.ARRAY_BUFFER, createdWhileLost);
    gl.bufferData(GL.ARRAY_BUFFER, new Uint8Array([4, 5]), GL.STATIC_DRAW);
    gl.bufferSubData(GL.ARRAY_BUFFER, -1, new Uint8Array([6]));
    gl.deleteBuffer(createdWhileLost);
    gl.deleteBuffer(createdWhileLost);
    check(evidence, 'lost-created isBuffer false after bind', gl.isBuffer(createdWhileLost), false);
    check(evidence, 'lost-created binding neutral', gl.getParameter(GL.ARRAY_BUFFER_BINDING), null);
    check(evidence, 'lost-created mutations have no error', gl.getError(), GL.NO_ERROR);
    if (hooks) {
      check(evidence, 'lost inspection neutral', hooks.inspectBuffer(buffer), null);
      check(evidence, 'lost-created inspection neutral', hooks.inspectBuffer(createdWhileLost), null);
    }
    return { backend, environment: context.environment, evidence };
  } finally { await context.dispose(); }
}

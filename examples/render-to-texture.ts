import * as refral from '@refral/webgl';
import { registerCanvasCleanup } from './canvas-lifecycle';

export type DemoBackend = 'native' | 'js' | 'rust' | 'refral';
export interface DemoOptions { transformContext?: (gl: WebGLRenderingContext) => WebGLRenderingContext }
const scriptLoads = new Map<string, Promise<void>>();

function loadScript(src: string) {
  let ready = scriptLoads.get(src);
  if (!ready) {
    ready = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src; script.dataset.fixture = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load ' + src + '. Run pnpm deps:sync.'));
      document.head.appendChild(script);
    });
    scriptLoads.set(src, ready);
  }
  return ready;
}

async function loadFixture() {
  await Promise.all([loadScript('/third_party/demo/webgl/resources/webgl-utils.js'),
    loadScript('/third_party/demo/webgl/resources/m4.js')]);
  const source = await fetch('/third_party/demo/webgl/webgl-render-to-texture.html');
  if (!source.ok) throw new Error('Demo fixture is missing. Run pnpm deps:sync.');
  const html = new DOMParser().parseFromString(await source.text(), 'text/html');
  const shaders: Record<string, string> = {};
  for (const original of html.querySelectorAll<HTMLScriptElement>('script[type^="x-shader/"]')) {
    shaders[original.id] = original.textContent ?? '';
    if (!document.getElementById(original.id)) document.head.appendChild(original.cloneNode(true));
  }
  return shaders;
}

export async function prepareDemo(canvas: HTMLCanvasElement, backend: DemoBackend, options: DemoOptions = {}) {
  const started = performance.now();
  const shaders = await loadFixture();
  const fixturePrepared = performance.now();
  const selected = backend === 'refral' ? 'js' : backend;
  const attributes: WebGLContextAttributes = {
    alpha: false, antialias: false, depth: true, stencil: false,
    premultipliedAlpha: true, preserveDrawingBuffer: true,
  };
  const gl = selected === 'native' ? canvas.getContext('webgl', attributes)
    : await refral.createWebGLOnWebGPU(canvas, { version: 1, core: selected, attributes });
  if (!gl) throw new Error('Demo context creation failed.');
  const contextPrepared = performance.now();
  const hooks = selected === 'native' ? null : refral.getTestingHooks(gl);
  const selectedCore = hooks?.core ?? 'native';
  if (selectedCore !== selected) throw new Error('Requested ' + selected + ', received ' + selectedCore);
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    if (hooks) await hooks.dispose();
    else gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
  registerCanvasCleanup(canvas, dispose);
  try {
    const adaptedPath = '/artifacts/fixtures/render-to-texture.mjs';
    const fixture = await import(/* @vite-ignore */ adaptedPath);
    const executionContext = options.transformContext?.(gl) ?? gl;
    const frame: (time: number) => void = fixture.createScene(executionContext, canvas);
    const resourcesPrepared = performance.now();
    const capture = async () => {
      if (hooks) return hooks.capture();
      const data = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return { width: canvas.width, height: canvas.height, data };
    };
    const nativeInfo = selected === 'native' ? gl.getExtension('WEBGL_debug_renderer_info') : null;
    return {
      gl, frame, capture, hooks, dispose, backend, selectedCore, shaders,
      environment: { ...(hooks?.environment ?? { userAgent: navigator.userAgent,
        renderer: gl.getParameter(gl.RENDERER), vendor: gl.getParameter(gl.VENDOR), version: gl.getParameter(gl.VERSION),
        unmaskedRenderer: nativeInfo ? gl.getParameter(nativeInfo.UNMASKED_RENDERER_WEBGL) : null,
        unmaskedVendor: nativeInfo ? gl.getParameter(nativeInfo.UNMASKED_VENDOR_WEBGL) : null }),
        attributes: gl.getContextAttributes(), devicePixelRatio: window.devicePixelRatio },
      timings: { fixturePreparationMs: fixturePrepared - started,
        contextInitializationMs: contextPrepared - fixturePrepared,
        resourcePreparationMs: resourcesPrepared - contextPrepared },
    };
  } catch (error) { await dispose(); throw error; }
}

export async function runDemo(canvas: HTMLCanvasElement, backend: DemoBackend) {
  const start = performance.now();
  const scene = await prepareDemo(canvas, backend);
  const initialized = performance.now();
  scene.frame(1000); scene.gl.flush();
  const firstFrameCpuMs = performance.now() - initialized;
  const image = await scene.capture();
  const firstImageCompleteMs = performance.now() - initialized;
  const error = scene.gl.getError();
  const validationErrors = [...scene.hooks?.errors ?? []];
  if (error || validationErrors.length) throw new Error('Demo rendering failed: ' + JSON.stringify({ error, validationErrors }));
  return {
    backend, selectedCore: scene.selectedCore, environment: scene.environment,
    initializationMs: initialized - start, timings: scene.timings,
    firstFrameCpuMs, firstImageCompleteMs, firstFrameAndReadbackMs: firstImageCompleteMs,
    width: image.width, height: image.height,
    nonWhitePixels: image.data.filter((value, index) => index % 4 !== 3 && value < 250).length,
    error, validationErrors, stats: scene.hooks ? { ...scene.hooks.stats } : null,
  };
}

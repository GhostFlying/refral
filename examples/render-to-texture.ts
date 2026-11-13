import * as refral from '@refral/webgl';
import { registerCanvasCleanup } from './canvas-lifecycle';

async function loadScript(src: string) {
  if (document.querySelector(`script[data-fixture="${src}"]`)) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.dataset.fixture = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}. Run pnpm deps:sync.`));
    document.head.appendChild(script);
  });
}

export async function prepareDemo(canvas: HTMLCanvasElement, backend: 'native' | 'refral') {
  await loadScript('/third_party/demo/webgl/resources/webgl-utils.js');
  await loadScript('/third_party/demo/webgl/resources/m4.js');
  const source = await fetch('/third_party/demo/webgl/webgl-render-to-texture.html');
  if (!source.ok) throw new Error('Demo fixture is missing. Run pnpm deps:sync.');
  const html = new DOMParser().parseFromString(await source.text(), 'text/html');
  for (const original of html.querySelectorAll<HTMLScriptElement>('script[type^="x-shader/"]')) {
    if (!document.getElementById(original.id)) document.head.appendChild(original.cloneNode(true));
  }
  const runtime = backend === 'refral' ? refral : null;
  const attributes = { alpha: false, antialias: false, depth: true, stencil: false, preserveDrawingBuffer: true };
  const gl = runtime
    ? await runtime.createWebGLOnWebGPU(canvas, { version: 1, ...attributes }) as unknown as WebGLRenderingContext
    : canvas.getContext('webgl', attributes) as WebGLRenderingContext | null;
  if (!gl) throw new Error('Demo context creation failed.');
  registerCanvasCleanup(canvas, async () => {
    if (runtime) await runtime.getTestingHooks(gl).dispose();
    else gl.getExtension('WEBGL_lose_context')?.loseContext();
  });
  const adaptedPath = '/artifacts/fixtures/render-to-texture.mjs';
  const fixture = await import(/* @vite-ignore */ adaptedPath);
  const frame: (time: number) => void = fixture.createScene(gl, canvas);
  const capture = async () => {
    if (runtime) return runtime.getTestingHooks(gl as never).capture();
    const data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return { width: canvas.width, height: canvas.height, data };
  };
  return { gl, frame, capture, hooks: runtime?.getTestingHooks(gl as never) };
}

export async function runDemo(canvas: HTMLCanvasElement, backend: 'native' | 'refral') {
  const start = performance.now();
  const scene = await prepareDemo(canvas, backend);
  const initialized = performance.now();
  scene.frame(1000);
  scene.gl.flush();
  const image = await scene.capture();
  const error = scene.gl.getError();
  const validationErrors = [...scene.hooks?.errors ?? []];
  if (error || validationErrors.length) throw new Error(`Demo rendering failed: ${JSON.stringify({ error, validationErrors })}`);
  return {
    backend,
    initializationMs: initialized - start,
    firstFrameAndReadbackMs: performance.now() - initialized,
    width: image.width,
    height: image.height,
    nonWhitePixels: image.data.filter((value, index) => index % 4 !== 3 && value < 250).length,
    error,
    validationErrors,
    stats: scene.hooks?.stats,
  };
}

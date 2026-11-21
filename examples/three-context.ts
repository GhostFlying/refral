import { createWebGLOnWebGPU, getTestingHooks } from '@refral/webgl';

export const threeBackends = ['native', 'js', 'rust'] as const;
export type ThreeBackend = typeof threeBackends[number];
export const threeCanvasSize = { width: 800, height: 600 };

export async function createThreeContext(canvas: HTMLCanvasElement, backend: ThreeBackend, size = threeCanvasSize) {
  canvas.width = size.width;
  canvas.height = size.height;
  const attributes = { alpha: false, depth: true, stencil: false, antialias: false, preserveDrawingBuffer: false };
  const gl = backend === 'native' ? canvas.getContext('webgl', attributes) as WebGLRenderingContext | null
    : await createWebGLOnWebGPU(canvas, { version: 1, core: backend, ...attributes });
  if (!gl) throw new Error('WebGL1 context creation failed.');
  return { gl, attributes, hooks: backend === 'native' ? null : getTestingHooks(gl) };
}

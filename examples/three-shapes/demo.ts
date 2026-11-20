import { TextureLoader, WebGL1Renderer } from 'three';
import { createWebGLOnWebGPU, getTestingHooks } from '@refral/webgl';
import { createShapesScene } from './scene';

export const shapesBackends = ['native', 'js', 'rust'] as const;
export type ShapesBackend = typeof shapesBackends[number];
export const shapesSize = { width: 800, height: 600 };
const grid = new URL('./uv_grid_opengl.jpg', import.meta.url).href;

export async function createShapesDemo(canvas: HTMLCanvasElement, backend: ShapesBackend) {
  canvas.width = shapesSize.width;
  canvas.height = shapesSize.height;
  const attributes = { alpha: false, depth: true, stencil: false, antialias: false, preserveDrawingBuffer: false };
  const contextStarted = performance.now();
  const gl = backend === 'native' ? (canvas.getContext('webgl', attributes) as WebGLRenderingContext | null)
    : await createWebGLOnWebGPU(canvas, { version: 1, core: backend, ...attributes });
  if (!gl) throw new Error('WebGL1 context creation failed.');
  const contextMs = performance.now() - contextStarted;
  const hooks = backend === 'native' ? null : getTestingHooks(gl);
  try {
    const sceneStarted = performance.now();
    const texture = await new TextureLoader().loadAsync(grid);
    const { scene, camera, group } = createShapesScene(texture, canvas.width / canvas.height);
    const renderer = new WebGL1Renderer({ canvas, context: gl, ...attributes });
    renderer.setPixelRatio(1);
    renderer.setSize(canvas.width, canvas.height, false);
    const sceneMs = performance.now() - sceneStarted;
    const debug = backend === 'native' ? gl.getExtension('WEBGL_debug_renderer_info') : null;
    return {
      backend: hooks?.core ?? 'native', gl, renderer, contextMs, sceneMs, hooks,
      environment: hooks?.environment ?? {
        version: gl.getParameter(gl.VERSION),
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      },
      render(rotation: number) {
        group.rotation.y = rotation;
        renderer.render(scene, camera);
      },
      async dispose() {
        renderer.dispose();
        texture.dispose();
        await hooks?.dispose();
      },
    };
  } catch (error) {
    await hooks?.dispose();
    throw error;
  }
}

import { createWebGLOnWebGPU, getTestingHooks } from '@refral/webgl';

interface Fixture { width: number; height: number; pixels: number[]; png: string }
type Backend = 'native' | 'js' | 'rust';

async function runDomDeployment(backend: Backend, fixture: Fixture) {
  const { width, height } = fixture;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const attributes = { alpha: true, antialias: false, depth: true, stencil: false, preserveDrawingBuffer: true };
  const gl = backend === 'native' ? canvas.getContext('webgl', attributes) as WebGLRenderingContext | null
    : await createWebGLOnWebGPU(canvas, { version: 1, core: backend, attributes });
  if (!gl) throw new Error(`Cannot create built ${backend} context.`);
  const hooks = backend === 'native' ? null : getTestingHooks(gl);
  try {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    const imageData = new ImageData(new Uint8ClampedArray(fixture.pixels), width, height);
    const image = new Image(); image.src = fixture.png; await image.decode();
    const sources = [{ name: 'imagedata', source: imageData, bytes: fixture.pixels },
      { name: 'htmlimage', source: image, bytes: fixture.pixels }];
    const canvases = [document.createElement('canvas'), new OffscreenCanvas(width, height)];
    const canvasSources = canvases.map((source, index) => {
      source.width = width; source.height = height;
      const context = source.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      context.putImageData(imageData, 0, 0);
      return { name: index ? 'offscreen' : 'canvas', source, bytes: Array.from(context.getImageData(0, 0, width, height).data) };
    });
    const captures = [];
    for (const entry of [...sources, ...canvasSources]) {
      for (const flip of [false, true]) {
        for (const premultiply of [false, true]) {
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, Number(flip));
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, Number(premultiply));
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.source);
          const pixels = new Uint8Array(width * height * 4);
          const framebufferStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          const expected = [];
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const offset = ((flip ? height - y - 1 : y) * width + x) * 4;
              const alpha = entry.bytes[offset + 3]!;
              const factor = premultiply ? alpha / 255 : 1;
              expected.push(Math.round(entry.bytes[offset]! * factor), Math.round(entry.bytes[offset + 1]! * factor),
                Math.round(entry.bytes[offset + 2]! * factor), alpha);
            }
          }
          captures.push({ source: entry.name, flip, premultiply, framebufferStatus,
            pixels: Array.from(pixels), expected, error: gl.getError() });
        }
      }
    }
    await hooks?.device.queue.onSubmittedWorkDone();
    return { requestedCore: backend, selectedCore: hooks?.core ?? 'native',
      environment: hooks?.environment ?? { userAgent: navigator.userAgent, renderer: gl.getParameter(gl.RENDERER) },
      attributes: gl.getContextAttributes(), captures, validationErrors: hooks?.errors.slice() ?? [] };
  } finally {
    if (hooks) await hooks.dispose();
    else gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

declare global { interface Window { runDomDeployment: typeof runDomDeployment } }
window.runDomDeployment = runDomDeployment;

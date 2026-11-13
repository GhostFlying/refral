export function serializeLimits(limits: GPUSupportedLimits): Record<string, number> {
  const result: Record<string, number> = {};
  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(limits))) {
    const value = (limits as unknown as Record<string, unknown>)[name];
    if (typeof value === 'number') result[name] = value;
  }
  return result;
}

export function nativeEnvironment(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: true, stencil: false });
  if (!gl) throw new Error('Native WebGL context creation failed.');
  gl.clearColor(0.1, 0.2, 0.35, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    version: gl.getParameter(gl.VERSION),
    shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    attributes: gl.getContextAttributes(),
    extensions: gl.getSupportedExtensions(),
  };
}

const shader = `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-0.8, -0.8), vec2f(0.8, -0.8), vec2f(0.0, 0.8));
  return vec4f(positions[i], 0.0, 1.0);
}
@fragment fn fs() -> @location(0) vec4f { return vec4f(0.2, 0.7, 0.4, 1.0); }
`;

export async function runProbe(canvas: HTMLCanvasElement, nativeCanvas: HTMLCanvasElement) {
  if (!navigator.gpu) throw new Error('navigator.gpu is unavailable. Use installed Chrome on localhost.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('Chrome did not provide a WebGPU adapter.');
  const device = await adapter.requestDevice();
  registerCanvasCleanup(canvas, () => device.destroy());
  const validationErrors: string[] = [];
  device.addEventListener('uncapturederror', (event) => validationErrors.push(event.error.message));
  device.pushErrorScope('validation');
  const module = device.createShaderModule({ code: shader });
  const compilation = await module.getCompilationInfo();
  const texture = device.createTexture({ size: [64, 64], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: 64 * 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('WebGPU canvas context creation failed.');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const presentation = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] } });
  const encoder = device.createCommandEncoder();
  for (const [view, selected] of [[texture.createView(), pipeline], [context.getCurrentTexture().createView(), presentation]] as const) {
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(selected);
    pass.draw(3);
    pass.end();
  }
  encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow: 256 }, [64, 64]);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const bytes = new Uint8Array(readback.getMappedRange());
  const center = [...bytes.subarray(32 * 256 + 32 * 4, 32 * 256 + 32 * 4 + 4)];
  const corner = [...bytes.subarray(0, 4)];
  readback.unmap();
  readback.destroy();
  texture.destroy();
  const validation = await device.popErrorScope();
  if (validation) validationErrors.push(validation.message);
  if (validationErrors.length) throw new Error(`WebGPU probe validation failed: ${validationErrors.join('\n')}`);
  const report = {
    recordedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    secureContext: isSecureContext,
    adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description },
    features: [...adapter.features],
    limits: serializeLimits(adapter.limits),
    native: nativeEnvironment(nativeCanvas),
    pixels: { center, corner, expectedCenter: [51, 179, 102, 255], expectedCorner: [0, 0, 0, 255] },
    compilation: compilation.messages.map(({ type, message }) => ({ type, message })),
    validationErrors,
  };
  // The configured canvas retains this device for presentation until the next probe.
  return report;
}
import { registerCanvasCleanup } from './canvas-lifecycle';

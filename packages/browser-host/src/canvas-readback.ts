import type { HostStats } from './index.js';

/** RGBA8 transport through opaque sRGB canvas pixels. */
export class CanvasReadback {
  readonly stats = { captures: 0, tiles: 0, imageBytes: 0, decodedBytes: 0, stagingBytes: 0 };
  private readonly canvas = new OffscreenCanvas(1, 1);
  private readonly context: GPUCanvasContext;
  private readonly sink = new OffscreenCanvas(1, 1);
  private readonly cpu: OffscreenCanvasRenderingContext2D;
  private readonly pipeline: GPURenderPipeline;
  private readonly parameters: GPUBuffer;
  private bindings = new WeakMap<GPUTexture, GPUBindGroup>();

  constructor(
    private readonly device: GPUDevice,
    private readonly hostStats: HostStats
  ) {
    const context = this.canvas.getContext('webgpu');
    const cpu = this.sink.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!context || !cpu) throw new DOMException('Canvas readback contexts are unavailable', 'NotSupportedError');
    this.context = context;
    this.cpu = cpu;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque', colorSpace: 'srgb' });
    const module = device.createShaderModule({
      code: `
      struct Parameters { offset: vec2u, padding: vec2u, };
      @group(0) @binding(0) var source: texture_2d<f32>;
      @group(0) @binding(1) var<uniform> parameters: Parameters;
      @vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
        var positions = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
        return vec4f(positions[index], 0., 1.);
      }
      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let pixel = vec2u(position.xy);
        let location = vec2i(vec2u(pixel.x / 2u, pixel.y) + parameters.offset);
        let rgba = textureLoad(source, location, 0);
        if (pixel.x % 2u == 0u) { return vec4f(rgba.rgb, 1.); }
        return vec4f(rgba.a, 0., 0., 1.);
      }`,
    });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    });
    this.parameters = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    hostStats.pipelines++;
    hostStats.allocatedBufferBytes += 16;
    hostStats.peakAllocatedBufferBytes = Math.max(hostStats.peakAllocatedBufferBytes, hostStats.allocatedBufferBytes);
  }

  capture(
    texture: GPUTexture,
    width: number,
    height: number,
    encoder: () => GPUCommandEncoder,
    submit: () => void,
    sourceX = 0,
    sourceY = 0
  ): Uint8Array {
    const output = new Uint8Array(width * height * 4);
    let binding = this.bindings.get(texture);
    if (!binding) {
      binding = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: { buffer: this.parameters } },
        ],
      });
      this.bindings.set(texture, binding);
      this.hostStats.bindGroups++;
    }
    const limit = this.device.limits.maxTextureDimension2D;
    const tileWidth = Math.floor(limit / 2);
    for (let y = 0; y < height; y += limit) {
      for (let x = 0; x < width; x += tileWidth) {
        const columns = Math.min(tileWidth, width - x);
        const rows = Math.min(limit, height - y);
        if (this.canvas.width !== columns * 2) this.canvas.width = this.sink.width = columns * 2;
        if (this.canvas.height !== rows) this.canvas.height = this.sink.height = rows;
        this.cpu.imageSmoothingEnabled = false;
        this.cpu.globalCompositeOperation = 'copy';
        this.device.queue.writeBuffer(this.parameters, 0, new Uint32Array([sourceX + x, sourceY + y, 0, 0]));
        this.hostStats.uploadedBytes += 16;
        const pass = encoder().beginRenderPass({
          colorAttachments: [
            {
              view: this.context.getCurrentTexture().createView(),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
            },
          ],
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, binding);
        pass.draw(3);
        pass.end();
        this.hostStats.passes++;
        // Complete each tile before reusing its uniform and canvas storage.
        submit();
        this.cpu.drawImage(this.canvas, 0, 0);
        const packed = this.cpu.getImageData(0, 0, columns * 2, rows).data;
        for (let row = 0; row < rows; row++) {
          for (let column = 0; column < columns; column++) {
            const from = (row * columns + column) * 8;
            const to = ((y + row) * width + x + column) * 4;
            output[to] = packed[from]!;
            output[to + 1] = packed[from + 1]!;
            output[to + 2] = packed[from + 2]!;
            output[to + 3] = packed[from + 4]!;
          }
        }
        this.stats.tiles++;
        this.stats.imageBytes += packed.byteLength;
        this.stats.stagingBytes = this.canvas.width * this.canvas.height * 8;
      }
    }
    this.stats.captures++;
    this.stats.decodedBytes += output.byteLength;
    return output;
  }

  dispose(): void {
    this.context.unconfigure();
    this.parameters.destroy();
    this.hostStats.allocatedBufferBytes -= 16;
    this.bindings = new WeakMap();
    this.canvas.width = this.sink.width = 1;
    this.canvas.height = this.sink.height = 1;
    this.stats.stagingBytes = 0;
  }
}

import type { HostStats } from './index.js';
import type { QueueCompletion } from './queue-completion.js';

type TexturePair = { source: GPUTexture; control: GPUTexture };

/** Blink can release a transferred texture while a standalone texture from the same publication remains usable. */
export class OffscreenDiscard {
  private pair: TexturePair | null = null;
  private skipThisTurn = false;

  private constructor(
    private readonly device: GPUDevice, private readonly stats: HostStats,
    private readonly completion: QueueCompletion, private readonly control: GPUCanvasContext,
    private readonly markers: GPUCanvasContext, private readonly cpu: OffscreenCanvasRenderingContext2D,
    private readonly scratch: GPUTexture, private readonly white: GPUBuffer,
    private readonly scratchBytes: number,
  ) {}

  static create(device: GPUDevice, format: GPUTextureFormat, alphaMode: GPUCanvasAlphaMode,
    stats: HostStats, completion: QueueCompletion): OffscreenDiscard | null {
    const control = new OffscreenCanvas(1, 1).getContext('webgpu');
    const markers = new OffscreenCanvas(2, 1).getContext('webgpu');
    const cpu = new OffscreenCanvas(2, 1).getContext('2d', { willReadFrequently: true });
    if (!control || !markers || !cpu) return null;
    let scratch: GPUTexture | undefined;
    let white: GPUBuffer | undefined;
    try {
      control.configure({ device, format, alphaMode, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      markers.configure({ device, format: 'rgba8unorm', alphaMode: 'opaque',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST });
      cpu.globalCompositeOperation = 'copy';
      scratch = device.createTexture({ size: [1, 1], format, usage: GPUTextureUsage.COPY_DST });
      white = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
      new Uint8Array(white.getMappedRange()).fill(255);
      white.unmap();
      const scratchBytes = format === 'rgba16float' ? 8 : 4;
      stats.allocatedTextureBytes += scratchBytes;
      stats.allocatedBufferBytes += white.size;
      stats.peakAllocatedTextureBytes = Math.max(stats.peakAllocatedTextureBytes, stats.allocatedTextureBytes);
      stats.peakAllocatedBufferBytes = Math.max(stats.peakAllocatedBufferBytes, stats.allocatedBufferBytes);
      return new OffscreenDiscard(device, stats, completion, control, markers, cpu, scratch, white, scratchBytes);
    } catch {
      white?.destroy();
      scratch?.destroy();
      control.unconfigure();
      markers.unconfigure();
      return null;
    }
  }

  private deferObservation(): void {
    if (this.skipThisTurn) return;
    this.skipThisTurn = true;
    queueMicrotask(() => { this.skipThisTurn = false; });
  }

  published(source: GPUTexture): void {
    if (this.pair?.source !== source) {
      this.pair = null;
      try { this.pair = { source, control: this.control.getCurrentTexture() }; }
      catch { return; }
    }
    this.deferObservation();
  }

  forget(): void { this.pair = null; }

  private submit(encoder: GPUCommandEncoder): void {
    this.device.queue.submit([encoder.finish()]);
    this.completion.markIssued();
    this.stats.submits++;
  }

  private markIfUsable(texture: GPUTexture, output: GPUTexture, x: number): void {
    // Validation rejects the whole command buffer when the source texture has expired.
    // The submitted marker is constant and independent of the user's pixel values.
    this.device.pushErrorScope('validation');
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToTexture({ texture }, { texture: this.scratch }, [1, 1]);
      encoder.copyBufferToTexture({ buffer: this.white }, { texture: output, origin: [x, 0] }, [1, 1]);
      this.submit(encoder);
      this.stats.copies += 2;
    } finally {
      void this.device.popErrorScope().catch(() => {});
    }
  }

  discarded(): boolean {
    const pair = this.pair;
    if (!pair || this.skipThisTurn) return false;
    this.deferObservation();
    this.stats.offscreenDiscardProbes++;
    try {
      const output = this.markers.getCurrentTexture();
      const encoder = this.device.createCommandEncoder();
      encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear',
        storeOp: 'store', clearValue: [1, 0, 1, 1] }] }).end();
      this.submit(encoder);
      this.stats.passes++;
      this.markIfUsable(pair.source, output, 0);
      this.markIfUsable(pair.control, output, 1);
      this.completion.markIssued();
      this.cpu.drawImage(this.markers.canvas, 0, 0);
      const pixels = this.cpu.getImageData(0, 0, 2, 1).data;
      if (pixels[4] === 255 && pixels[5] === 255 && pixels[6] === 255 && pixels[7] === 255) {
        // Opaque magenta proves the marker was initialized even when a lost canvas returns black.
        const discarded = pixels[0] === 255 && pixels[1] === 0 && pixels[2] === 255 && pixels[3] === 255;
        if (discarded) {
          this.stats.offscreenDiscards++;
          return true;
        }
        if (pixels[0] === 255 && pixels[1] === 255 && pixels[2] === 255 && pixels[3] === 255) return false;
      }
    } catch {
      // Unavailable resources or a failed read cannot establish that the canvas was composited.
    } finally {
      this.completion.observe();
    }
    this.stats.offscreenDiscardIndeterminate++;
    return false;
  }

  dispose(): void {
    this.forget();
    this.control.unconfigure();
    this.markers.unconfigure();
    this.scratch.destroy();
    this.white.destroy();
    this.stats.allocatedTextureBytes -= this.scratchBytes;
    this.stats.allocatedBufferBytes -= this.white.size;
  }
}

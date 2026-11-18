import type { DomTextureUploadPlan, PixelUpload } from '@refral/core-api';

/** Private native upload captures decoded images and current video frames with WebGL unpack rules. */
export class ImageExtractor {
  private readonly gl: WebGLRenderingContext;
  private readonly texture: WebGLTexture;
  private readonly framebuffer: WebGLFramebuffer;
  private readonly limit: number;

  constructor() {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl', {
      alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false,
    });
    if (!gl) throw new DOMException('Native WebGL image extraction is unavailable.', 'NotSupportedError');
    this.gl = gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      throw new DOMException('Cannot allocate the image extraction resources.', 'InvalidStateError');
    }
    this.texture = texture;
    this.framebuffer = framebuffer;
    this.limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  }

  private check(error = this.gl.getError()): void {
    if (this.gl.isContextLost() || error !== this.gl.NO_ERROR) {
      throw new DOMException(`Native image extraction failed with GL error ${error}.`, 'InvalidStateError');
    }
  }

  /** Outside reads retain their destination. Two sentinels distinguish every possible RGBA pixel. */
  private contains(x: number, y: number): boolean {
    const first = new Uint8Array(4);
    const second = new Uint8Array(4).fill(255);
    const gl = this.gl;
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, first);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, second);
    return first.every((value, index) => value === second[index]);
  }

  private dimension(horizontal: boolean, guess: number): number {
    const contains = (coordinate: number) => this.contains(horizontal ? coordinate : 0, horizontal ? 0 : coordinate);
    if (guess > 0 && contains(guess - 1) && !contains(guess)) return guess;
    // Density-corrected image sizes and the display extent of a video can differ from uploaded storage.
    let lower = 0;
    let upper = this.limit;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (contains(middle)) lower = middle + 1;
      else upper = middle;
    }
    return lower;
  }

  capture(source: HTMLImageElement | HTMLVideoElement, guessWidth: number, guessHeight: number, plan: DomTextureUploadPlan) {
    const gl = this.gl;
    this.check();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, Number(plan.flipY));
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, Number(plan.premultiplyAlpha));
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, plan.colorSpaceConversion);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const error = gl.getError();
    const unavailable = { width: 0, height: 0,
      pixels: (): PixelUpload => ({ bytes: new Uint8Array(0), viewType: 'Uint8Array', source: 'dom-converted' }) };
    if (error === gl.INVALID_VALUE) return unavailable;
    this.check(error);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return unavailable;
    const width = this.dimension(true, guessWidth);
    const height = this.dimension(false, guessHeight);
    this.check();
    return { width, height, pixels: (): PixelUpload => {
      const bytes = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      this.check();
      return { bytes, viewType: 'Uint8Array', source: 'dom-converted' };
    } };
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture);
    this.gl.deleteFramebuffer(this.framebuffer);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

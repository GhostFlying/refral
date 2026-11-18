import { prepareRttContext, rttProgram, rttTexture, rttTextureFragment } from './rtt-cases';
import type { DrawingBackend } from './dual-core-cases';

function mediaEvent(video: HTMLVideoElement, name: 'loadeddata' | 'seeked'): Promise<void> {
  return new Promise((resolve, reject) => {
    const listeners = new AbortController();
    video.addEventListener(name, () => {
      listeners.abort();
      resolve();
    }, { once: true, signal: listeners.signal });
    video.addEventListener('error', () => {
      listeners.abort();
      reject(new Error(video.error?.message || 'Could not decode the test video.'));
    }, { once: true, signal: listeners.signal });
  });
}

function exceptionName(action: () => void): string | null {
  try { action(); return null; }
  catch (error) { return error instanceof Error ? error.name : String(error); }
}

export async function runVideoUploadCase(backend: DrawingBackend, asset: string, crossOriginAsset: string) {
  const context = await prepareRttContext(backend, 64, 32, true);
  const { gl } = context;
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const owner = iframe.contentDocument!;
  const video = owner.createElement('video');
  const otherVideo = document.createElement('video');
  const errors: number[] = [];
  function load(element: HTMLVideoElement, url: string) {
    const ready = mediaEvent(element, 'loadeddata');
    element.preload = 'auto';
    element.muted = true;
    element.src = url;
    return ready;
  }
  function image(source: HTMLVideoElement) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }
  function subImage(source: HTMLVideoElement) {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }
  function capture() {
    const pixels = new Uint8Array(64 * 32 * 4);
    gl.readPixels(0, 0, 64, 32, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    errors.push(gl.getError());
    return [8, 24, 40, 56].map(x => Array.from(pixels.subarray((8 * 64 + x) * 4, (8 * 64 + x) * 4 + 4)));
  }
  try {
    owner.body.append(video);
    document.body.append(otherVideo);
    const program = rttProgram(gl, undefined, rttTextureFragment);
    gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
    rttTexture(gl, 32, 32, null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 8);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    errors.push(gl.getError());

    image(video);
    const emptyImage = gl.getError();
    subImage(video);
    const emptySubImage = gl.getError();

    await load(video, asset);
    const dimensions = [video.videoWidth, video.videoHeight];
    // Source geometry is platform state, even when a same-origin child shadows its properties.
    Object.defineProperties(video, { width: { value: 1 }, height: { value: 1 },
      videoWidth: { value: 1 }, videoHeight: { value: 1 } });
    image(video);
    errors.push(gl.getError());
    const sought = mediaEvent(video, 'seeked');
    video.currentTime = 0.25;
    await sought;
    gl.viewport(0, 0, 32, 32);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    subImage(video);
    errors.push(gl.getError());
    gl.viewport(32, 0, 32, 32);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const orderedPixels = capture();

    await load(otherVideo, crossOriginAsset);
    const taintedImage = exceptionName(() => image(otherVideo));
    const taintedSubImage = exceptionName(() => subImage(otherVideo));
    errors.push(gl.getError());
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const retainedPixels = capture();

    otherVideo.crossOrigin = 'anonymous';
    await load(otherVideo, crossOriginAsset + '?cors=1');
    image(otherVideo);
    errors.push(gl.getError());
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const corsPixels = capture();

    await context.hooks?.device.queue.onSubmittedWorkDone();
    return { backend, selectedCore: context.selectedCore, environment: context.environment, dimensions,
      emptyImage, emptySubImage, taintedImage, taintedSubImage, orderedPixels, retainedPixels, corsPixels,
      errors, validationErrors: context.hooks?.errors ?? [] };
  } finally {
    for (const element of [video, otherVideo]) {
      element.removeAttribute('src');
      element.load();
      element.remove();
    }
    iframe.remove();
    await context.dispose();
  }
}

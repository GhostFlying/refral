import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const output = process.argv[2] ?? 'artifacts/opaque-discard';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 100 }, deviceScaleFactor: 1 });
  await page.route('http://localhost/', route => route.fulfill({
    contentType: 'text/html',
    body: '<style>body{background:lime;margin:0}canvas{position:absolute;top:0;width:24px;height:24px}</style><body></body>',
  }));
  await page.goto('http://localhost/');

  const state = await page.evaluateHandle(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('A WebGPU adapter is required.');
    const device = await adapter.requestDevice();
    const configuration = { device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' };
    const records = [];
    const validationErrors = [];
    device.addEventListener('uncapturederror', event => validationErrors.push(event.error.message));
    function read(canvas) {
      const scratch = document.createElement('canvas');
      scratch.width = scratch.height = 1;
      const context = scratch.getContext('2d');
      context.drawImage(canvas, 0, 0);
      return [...context.getImageData(0, 0, 1, 1).data];
    }
    function clear(context, red, blue = 0) {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store',
        clearValue: { r: red, g: 0, b: blue, a: 1 },
      }] });
      pass.end();
      device.queue.submit([encoder.finish()]);
    }
    function gpuCanvas() {
      const source = new OffscreenCanvas(16, 16);
      const context = source.getContext('webgpu');
      context.configure(configuration);
      clear(context, 1);
      return { source, context };
    }
    function nativePresenter(canvas) {
      const { source, context } = gpuCanvas();
      const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
      if (!gl) throw new Error('Native WebGL2 presentation is unavailable.');
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
      function publish() {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error('Native presentation read framebuffer is incomplete.');
        }
        gl.blitFramebuffer(0, 0, 16, 16, 0, 0, 16, 16, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Native WebGL2 blit failed.');
      }
      publish();
      return () => { clear(context, 0, 1); publish(); };
    }
    const names = ['webgl', 'webgl-preserve', 'gpu', 'gpu-context-alpha-false', 'gpu-copy-src',
      'gpu-reacquire', 'gpu-cleared', 'gpu-configure', 'bitmap', 'bitmap-null',
      '2d', '2d-reset', 'placeholder', 'gpu-to-webgl2'];
    for (const [index, name] of names.entries()) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      canvas.style.left = index * 32 + 'px';
      document.body.append(canvas);
      let action = () => {};
      if (name === 'gpu-to-webgl2') {
        action = nativePresenter(canvas);
      } else if (name.startsWith('webgl')) {
        const gl = canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: name === 'webgl-preserve' });
        gl.clearColor(1, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      } else if (name.startsWith('bitmap')) {
        const bitmap = canvas.getContext('bitmaprenderer', { alpha: false });
        bitmap.transferFromImageBitmap(gpuCanvas().source.transferToImageBitmap());
        if (name === 'bitmap-null') action = () => bitmap.transferFromImageBitmap(null);
      } else if (name.startsWith('2d')) {
        const context = canvas.getContext('2d', { alpha: false });
        context.drawImage(gpuCanvas().source, 0, 0);
        if (name === '2d-reset') action = () => context.reset();
      } else {
        const source = name === 'placeholder' ? canvas.transferControlToOffscreen() : canvas;
        const context = source.getContext('webgpu', name === 'gpu-context-alpha-false' ? { alpha: false } : {});
        context.configure(name === 'gpu-copy-src' ? { ...configuration,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC } : configuration);
        clear(context, 1);
        if (name === 'gpu-reacquire') action = () => context.getCurrentTexture();
        if (name === 'gpu-cleared') action = () => clear(context, 0);
        if (name === 'gpu-configure') action = () => context.configure(configuration);
      }
      records.push({ name, canvas, action, immediate: read(canvas) });
    }
    return {
      metadata: { names, adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
        device: adapter.info.device, description: adapter.info.description },
        immediate: Object.fromEntries(records.map(row => [row.name, row.immediate])) },
      validationErrors,
      async frames() {
        for (let i = 0; i < 6; i++) await new Promise(resolve => requestAnimationFrame(resolve));
      },
      readAll() { return Object.fromEntries(records.map(row => [row.name, read(row.canvas)])); },
      act() { for (const row of records) row.action(); return this.readAll(); },
    };
  });
  const metadata = await state.evaluate(state => state.metadata);
  async function capture(label) {
    const png = PNG.sync.read(await page.screenshot({ path: join(output, label + '.png') }));
    return Object.fromEntries(metadata.names.map((name, index) => {
      const start = 4 * (png.width * 12 + index * 32 + 12);
      return [name, [...png.data.subarray(start, start + 4)]];
    }));
  }
  await state.evaluate(state => state.frames());
  const screenBefore = await capture('before');
  const afterComposite = await state.evaluate(state => state.readAll());
  const afterAction = await state.evaluate(state => state.act());
  await state.evaluate(state => state.frames());
  const screenAfter = await capture('after');
  const afterNextComposite = await state.evaluate(state => state.readAll());
  const validationErrors = await state.evaluate(state => state.validationErrors);
  const report = { chrome: browser.version(), ...metadata, screenBefore, afterComposite,
    afterAction, screenAfter, afterNextComposite, validationErrors };
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Wrote browser, adapter, per-method RGBA samples and screenshots to', output);
} finally { await browser.close(); }

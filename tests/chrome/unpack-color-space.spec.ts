import { expect, test } from '@playwright/test';

for (const core of ['js', 'rust'] as const) {
  test(`${core} texture unpack color space converts the source before packing`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async core => {
      const path = '/packages/webgl/src/index.ts';
      const { prepareContextFactory, getTestingHooks } = await import(/* @vite-ignore */ path);
      const factory = await prepareContextFactory({ version: 1, core });
      const gl = factory(document.createElement('canvas'));
      const other = factory(document.createElement('canvas'));
      const native = document.createElement('canvas').getContext('webgl')!;
      const srgb = document.createElement('canvas');
      srgb.width = srgb.height = 1;
      const context = srgb.getContext('2d')!;
      context.fillStyle = 'red';
      context.fillRect(0, 0, 1, 1);
      const p3 = new OffscreenCanvas(1, 1);
      p3.getContext('2d', { colorSpace: 'display-p3' })!.putImageData(
        new ImageData(new Uint8ClampedArray([51, 128, 204, 255]), 1, 1, { colorSpace: 'display-p3' }), 0, 0);
      const transparent = new ImageData(new Uint8ClampedArray([255, 0, 0, 0]), 1, 1);
      const p3Bytes = new ImageData(new Uint8ClampedArray([234, 51, 35, 255]), 1, 1, { colorSpace: 'display-p3' });
      const image = new Image();
      image.src = srgb.toDataURL();
      await image.decode();
      const bitmap = await createImageBitmap(srgb, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const p3Bitmap = await createImageBitmap(p3, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const frame = new VideoFrame(srgb, { timestamp: 0 });

      function upload(
        context: WebGLRenderingContext, source: TexImageSource | Uint8Array<ArrayBuffer>, sub: boolean,
        destination: PredefinedColorSpace, convert: boolean,
      ) {
        const { TEXTURE_2D, RGBA, UNSIGNED_BYTE, FRAMEBUFFER, COLOR_ATTACHMENT0 } = context;
        const texture = context.createTexture();
        const framebuffer = context.createFramebuffer();
        try {
          context.unpackColorSpace = destination;
          context.pixelStorei(context.UNPACK_COLORSPACE_CONVERSION_WEBGL, convert ? context.BROWSER_DEFAULT_WEBGL : context.NONE);
          context.bindTexture(TEXTURE_2D, texture);
          if (source instanceof Uint8Array) {
            context.texImage2D(TEXTURE_2D, 0, RGBA, 1, 1, 0, RGBA, UNSIGNED_BYTE, source);
          } else if (sub) {
            context.texImage2D(TEXTURE_2D, 0, RGBA, 1, 1, 0, RGBA, UNSIGNED_BYTE, null);
            context.texSubImage2D(TEXTURE_2D, 0, 0, 0, RGBA, UNSIGNED_BYTE, source);
          } else {
            context.texImage2D(TEXTURE_2D, 0, RGBA, RGBA, UNSIGNED_BYTE, source);
          }
          context.bindFramebuffer(FRAMEBUFFER, framebuffer);
          context.framebufferTexture2D(FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, texture, 0);
          const rgba = new Uint8Array(4);
          context.readPixels(0, 0, 1, 1, RGBA, UNSIGNED_BYTE, rgba);
          return { error: context.getError(), rgba: [...rgba] };
        } finally {
          context.deleteFramebuffer(framebuffer);
          context.deleteTexture(texture);
        }
      }

      try {
        const initial = gl.unpackColorSpace;
        gl.unpackColorSpace = 'display-p3';
        let invalid: string | undefined;
        try { Reflect.set(gl, 'unpackColorSpace', 'Display-P3'); }
        catch (error) { invalid = (error as Error).name; }
        const state = [initial, invalid, gl.unpackColorSpace, other.unpackColorSpace, gl.drawingBufferColorSpace];
        const cases = Object.entries({ srgb, p3, transparent, p3Bytes, image, bitmap, p3Bitmap, frame,
          raw: new Uint8Array([255, 0, 0, 255]) });
        const rows = cases.flatMap(([name, source]) =>
          (['srgb', 'display-p3'] as const).flatMap(destination =>
            [false, true].flatMap(convert => [false, true].map(sub => ({
              name, destination, convert, sub,
              refral: upload(gl, source, sub, destination, convert),
              native: upload(native, source, sub, destination, convert),
            })))));
        return { state, rows, core: getTestingHooks(gl).core, errors: getTestingHooks(gl).errors };
      } finally {
        frame.close();
        bitmap.close();
        p3Bitmap.close();
        await factory.dispose();
      }
    }, core);

    expect(result.core).toBe(core);
    expect(result.state).toEqual(['srgb', 'TypeError', 'display-p3', 'srgb', 'srgb']);
    expect(result.errors).toEqual([]);
    for (const row of result.rows) {
      const label = `${row.name} to ${row.destination}, convert=${row.convert}, sub=${row.sub}`;
      expect.soft(row.refral.error, label).toBe(0);
      expect.soft(row.native.error, label).toBe(0);
      let expected = row.native.rgba;
      if (row.name === 'transparent') {
        expected = row.convert && row.destination === 'display-p3' ? [234, 51, 35, 0] : [255, 0, 0, 0];
      }
      if (!row.convert && row.name === 'srgb') expected = [255, 0, 0, 255];
      if (!row.convert && row.name === 'p3') expected = [51, 128, 204, 255];
      if (!row.convert && row.name === 'p3Bytes') expected = [234, 51, 35, 255];
      expect.soft(row.refral.rgba.every((value, index) => Math.abs(value - expected[index]!) <= 1),
        `${label}, actual ${row.refral.rgba}, expected ${expected}`).toBe(true);
      if (row.name === 'srgb' && row.destination === 'display-p3' && row.convert) {
        expect.soft(row.refral.rgba, label).toEqual([234, 51, 35, 255]);
      }
    }
  });
}

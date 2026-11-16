# Chrome external-image alpha investigation

Recorded on 2026-11-16 while preparing task031 and task032. The runtime is headless Chrome 157.0.8103.51 on macOS arm64, using the Apple Metal hardware adapter, with `isFallbackAdapter` false. Chromium SCM revision is `653674df293788cf4932c40d914e9e15b41a2d31`. Its pinned Skia revision is `ca84ce0a6f1659748188469a89361ccea71e3a64`.

## Reproduction and observations

The standalone probe creates a 4×2 PNG with exact unpremultiplied RGBA bytes. It injects a Display P3 ICC profile from a browser-generated PNG while retaining the original IDAT pixels, then compares native WebGL upload/readback, Canvas2D extraction and WebGPU external-image copy/readback. The tagged and plain PNGs are independently decoded with pngjs to check their pixel identity. Every browser uses a fresh isolated headless profile and closes in a finally block.

WebGPU copies target `display-p3` so the following comparison retains the same source and destination gamut. PMA is the destination `premultipliedAlpha` option.

| Source with original pixel `[35,221,92,127]` | PMA false | PMA true |
| --- | --- | --- |
| Display P3 ImageData | `[35,221,92,127]` | `[17,110,46,127]` |
| Display P3 ICC PNG as HTMLImageElement | `[17,110,46,127]` | `[8,55,23,127]` |
| Same PNG pixels with cICP `[12,13,0,1]` | `[35,221,92,127]` | `[17,110,46,127]` |

The ICC path introduces one premultiplication before the final copy. Alpha-zero RGB is erased. Alpha-one RGB is reduced to almost zero, with further reduction when destination PMA is enabled. RGBA8, BGRA8, RGBA8-sRGB and RGBA16float destination experiments reproduce the issue. A copy performed before any native WebGL upload reproduces it too.

The cICP control changes the color-space representation and retains identical IDAT pixels. Its recovery matches the source-derived branch explanation below. Raw evidence is in `artifacts/dom-input/probes/extraction.json`, `extraction-formats.json`, `extraction-cpu-path.json` and `extraction-cicp.json`, with corresponding `.mjs` scripts and logs. Records include launch arguments, browser, adapter, palette bytes and per-copy results.

## Source-derived cause

HTMLImage extraction explicitly requests an unpremultiplied decode and retains the source ICC tag. The intermediate mailbox texture carries the image's alpha metadata and its `gfx::ColorSpace`. [HTMLImage extraction](https://github.com/chromium/chromium/blob/653674df293788cf4932c40d914e9e15b41a2d31/third_party/blink/renderer/modules/webgpu/external_image_utils.cc#L70), [unpremultiplied decoder request](https://github.com/chromium/chromium/blob/653674df293788cf4932c40d914e9e15b41a2d31/third_party/blink/renderer/platform/graphics/gpu/image_extractor.cc#L98), [mailbox allocation and upload](https://github.com/chromium/chromium/blob/653674df293788cf4932c40d914e9e15b41a2d31/third_party/blink/renderer/platform/graphics/gpu/webgpu_mailbox_texture.cc#L77)

ICC stores a quantized matrix. Chromium recognizes its primaries as named Display P3 within a 0.001 tolerance and subsequently reconstructs the named matrix. The measured maximum difference between the fixture ICC matrix and named float32 matrix is `7.458031177520752e-6`. Raster's direct-upload condition requires strict `SkColorSpace::Equals`, so the reconstructed matrix selects the SkSurface fallback. ImageData and the cICP control start with the named representation. [P3 recognition](https://github.com/chromium/chromium/blob/653674df293788cf4932c40d914e9e15b41a2d31/ui/gfx/color_space.cc#L237), [matrix reconstruction](https://github.com/chromium/chromium/blob/653674df293788cf4932c40d914e9e15b41a2d31/ui/gfx/color_space.cc#L713), [strict upload condition](https://github.com/chromium/chromium/blob/653674df293788cf4932c40d914e9e15b41a2d31/gpu/command_buffer/service/raster_decoder.cc#L1996), [PNG cICP precedence](https://github.com/google/skia/blob/ca84ce0a6f1659748188469a89361ccea71e3a64/src/codec/SkPngRustCodec.cpp#L136)

Fallback writes the unpremultiplied pixels through a GPU SkSurface whose device uses premultiplied alpha. The shared-image metadata retains the original alpha type. The final WebGPU copy obtains its source alpha mode from the original image, so PMA false exposes the intermediate premultiplied bytes and PMA true multiplies them again. Chromium already has an adjacent workaround that bypasses this mailbox path for CPU-backed unpremultiplied images with a null color space. Tagged ICC images carry a nonnull color space. [Raster fallback](https://github.com/chromium/chromium/blob/653674df293788cf4932c40d914e9e15b41a2d31/gpu/command_buffer/service/raster_decoder.cc#L2032), [Skia device alpha type](https://github.com/google/skia/blob/ca84ce0a6f1659748188469a89361ccea71e3a64/src/gpu/ganesh/Device.cpp#L201), [final source alpha mode](https://github.com/chromium/chromium/blob/653674df293788cf4932c40d914e9e15b41a2d31/third_party/blink/renderer/modules/webgpu/external_image_utils.cc#L204), [existing mailbox bypass](https://github.com/chromium/chromium/blob/653674df293788cf4932c40d914e9e15b41a2d31/third_party/blink/renderer/modules/webgpu/external_image_utils.cc#L462)

The pixel experiments and the cICP control directly observe the behavior. Entry into the individual GPU-process branch is inferred from the pinned source and distinguishing control. A logged Chromium build or internal branch trace would provide direct branch evidence.

## Consequences for synchronous DOM upload

Alpha-zero RGB and low-alpha precision are already lost in the intermediate texture. A subsequent unpremultiply cannot recover their original values. Canvas2D extraction also uses a premultiplied representation and shows the corresponding loss. Native WebGL's HTMLImage upload can retain those bytes through its decoder path.

WebGL `UNPACK_COLORSPACE_CONVERSION_WEBGL=NONE` additionally requires the source's encoded values, while WebGPU external copy accepts a destination color space and converts to it. An asynchronously created ImageBitmap with `premultiplyAlpha: 'none'` and `colorSpaceConversion: 'none'` could use the existing Chromium mailbox bypass. Its asynchronous creation requires separate verification and source-preparation planning.

After reviewing the investigation, the user approved a private native WebGL extraction context for HTMLImage fidelity in task032. Task031 accepts unorm8 sRGB ImageData through direct source bytes. Canvas and HTMLImage acceptance are tracked independently by task032.

# WebGL1 texture upload color space and conformance branch coverage

Implement the context's unpackColorSpace attribute for both cores. The facade owns the destination encoding and passes it to shared DOM capture. Existing core texture preflight and ordered byte uploads remain the integration points.

The pinned WebGL1 IDL defaults to srgb and accepts the HTML PredefinedColorSpace enum. TexImageSource uploads convert to the selected encoding before texture format packing. UNPACK_COLORSPACE_CONVERSION_WEBGL set to NONE preserves the source encoding on applicable DOM sources. TypedArray uploads have no color conversion. ImageBitmap ignores the three legacy unpack flags and still converts to the destination encoding. Use the existing native capture for decoded sources. The WebGPU canvas capture uses the destination encoding, or the source encoding under NONE. For externally supplied canvases, a synchronous WebCodecs snapshot supplies the source color metadata. Convert accepted ImageData without passing straight alpha through a premultiplied canvas. [Pinned IDL and upload rules](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#TEXIMAGE2D_HTML)

Verify public state, independent contexts, both upload overload families, target encoding, NONE, byte uploads and alpha with native and pixel expectations. Run pnpm check, actual Wasm, headless Chrome browser regressions and unchanged original video and texture cases. Re-run the full pinned inventory, then audit passing files with different assertion counts against their original branches and capability limits. Preserve raw file outcomes and report confirmed reduced coverage, limits and unresolved differences.

## Focused verification

The nine original cases that previously omitted upload color-space variants reach 451 passing assertions per backend. The eight ordinary video formats reach 50 each and the float video case reaches 51. Each Refral core adds 216 passing assertions relative to the earlier 235 in these same nine files. Native, JS and Rust also pass the original context property case with four assertions each. The half-float video file still depends on an unavailable half-float extension.

The shared browser tests exercise both upload overloads for sRGB and Display P3 canvas and ImageData sources, a decoded PNG, ImageBitmap, VideoFrame and TypedArray data. On captured Chrome 158, native applies the destination color space to Canvas and ImageData even with NONE. Refral tests the source encoding directly for those cases. The source metadata probe avoids acquiring a rendering context on an externally supplied canvas. The converted texture is independent of the canvas drawing-buffer display color space. [Pinned pixel storage](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#PIXEL_STORAGE_PARAMETERS) · [Chrome unpack state](https://github.com/chromium/chromium/blob/158.0.8127.36/third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc#L5327)

The build passed `pnpm check`, 55 actual-Wasm tests and all 204 headless Chrome tests. Production preview passed the probe, RTT, triangle, public readPixels, DOM and CubeMap checks. The focused raw official evidence is under `artifacts/conformance/campaign/unpack-color-target`. The production capture is under `artifacts/conformance/campaign/unpack-color-deploy`.

## Audit of branch-dependent passes

The previous full run at f1dac24 supplies 72 passing originals with different assertion counts on the three backends. All 72 had fewer assertions per Refral core. The original test sources, reported limits and existing per-assertion audits identify the causes below. A file may pass its original applicable assertions while leaving a capability untested.

| Cause | Original files | Examples |
| --- | ---: | --- |
| Extension-dependent behavior | 51 | ANGLE_instanced_arrays, WebGL multi-draw, compressed textures, half-float, depth textures, derivative hints |
| Instancing and reported attribute limit in the same file | 1 | #14 |
| Optional framebuffer behavior | 2 | #50 multisampling and #627 complete colorless framebuffer |
| Destination upload color space | 9 | #90 and #786–793, now exercised on all three paths |
| Reported capacity only | 8 | #0, #1, #4, #8, #9, #680, #733 and #735 |
| Advertised extension enumeration | 1 | #84 checks the objects for each name in getSupportedExtensions |

The first four rows total 63 files with capability-dependent coverage before this change. Of those, 54 are outside the color-space group. The eight capacity cases and the extension enumeration account for nine additional files with fewer assertions. [Attribute counts](102-attribute-assertion-coverage.md) · [Framebuffer and texture counts](106-framebuffer-and-texture-assertion-coverage.md) · [Multi-draw and queries](107-multidraw-and-query-assertion-coverage.md)

A source scan also found 11 equal-count files with direct skip or unavailable markers in their test scripts. The headless observer reran all 11 on each backend with the original DOM logs visible. Both observed fallback message families, the optional OffscreenCanvas commit method and three unsupported renderbuffer formats, ran identically on all three. The other nine showed none of those markers. The count above measures identified branch differences for this checkout and browser. A silent branch can substitute another assertion with the same count. The output preserves both the per-file classification and these additional observations under `artifacts/conformance/campaign/unpack-color-audit`.

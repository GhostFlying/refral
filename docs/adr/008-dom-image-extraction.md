# ADR 008 — Synchronous DOM image extraction

Status is accepted on 2026-11-16. The user approved a private native WebGL context for HTMLImageElement extraction after the Chrome ICC investigation.

## Evidence and decision

The [external-image investigation](../references/chrome-external-image-alpha.md) records headless Chrome157 on the Apple Metal hardware adapter. ICC PNG external copies introduce an extra premultiplication and erase alpha-zero RGB. Keeping PNG pixels identical and replacing the ICC marker with cICP restores correct single-premultiply behavior. Pinned Chromium/Skia source explains the color-space-dependent intermediate upload branch. Internal branch entry remains source-derived.

Use direct bytes for accepted ImageData. Use WebGPU external copy and the existing opaque Canvas2D readback transport for Canvas and OffscreenCanvas. Use a private native WebGL upload, temporary RGBA framebuffer and synchronous readPixels for HTMLImageElement. The image extractor passes the destination context's unpack flip/PMA/colorspace choices to native upload and returns tightly packed RGBA with the dom-converted marker. The selected semantic core subsequently performs its output-format normalization and destination state/version changes.

The native image helper is lazy and owned by one facade context. Image use requires native WebGL availability at runtime. Failure to obtain that helper reports NotSupportedError. Disposal releases its texture, framebuffer and context. Shader compilation, ordinary application drawing, target resources and submission use the selected JS/Rust core and common WebGPU host.

## Source validation and ownership

Scalar WebIDL conversion completes before intrinsic DOM inspection. Ready image extraction enforces origin security before ordinary destination GL validation. Native upload fixes the source image at call time. Full RGBA readback and destination commit follow pure semantic preflight. Generic Canvas origin validation reads a discarded1×1 Canvas2D snapshot before preflight. Full external-copy capture follows successful preflight and preserves source WebGL alpha-zero RGB. The focused probe in artifacts/dom-input/probes/canvas-gl-alpha.json records alpha0/1/127/255 with both destination alpha modes. ImageData/Canvas pixels are consumed synchronously as well. Valid source encodings outside the accepted profile retain explicit capability diagnostics.

Native WebGL exposes the uploaded texture through a framebuffer. Its actual dimensions can differ from density-corrected naturalWidth or SVG attributes. The helper verifies a natural-size guess through framebuffer boundary reads and uses bounded binary search when that guess differs. Two destination sentinels distinguish an inside pixel from an outside read for every RGBA value. The pinned outside-read rule retains destination bytes, and browser fixtures verify both srcset and SVG sizing. The probes and image readback add synchronous extraction cost included in DOM performance samples.

Before extracting a Refral source canvas, its registered host initializes the current-sized default target, ends pending work and submits presentation. This operation selects the default drawing buffer independently of the source core's current FBO binding. The registration is removed on facade disposal. The destination upload snapshots the resulting Canvas pixels before returning.

## HTMLVideoElement

Task050 extends the same private extractor to decoded video frames. Headless Chrome probes found differences between native WebGL video upload and WebGPU external copy for ordinary, rotated, and transparent clips. Native upload applies the configured WebGL unpack flags and enforces CORS. The extractor resolves the actual upload extent because display dimensions can differ from frame pixel dimensions. A successful capture transfers owned bytes to the selected core, which handles the application texture and queued work. The helper performs a synchronous readback on each accepted call. [Video verification](../tasks/050-video-texture-uploads.md)

## ImageBitmap

Task051 extends the private extractor to ImageBitmap. Native upload consumes the bitmap with its internal orientation, alpha representation and color encoding. Intrinsic width and height provide the exact capture extent, so the bitmap path uses a single RGBA readback after destination validation. Closed and transferred-away bitmaps report zero dimensions and reach the core's INVALID_VALUE path. Origin security is enforced by native upload before the destination is changed. [ImageBitmap verification](../tasks/051-imagebitmap-texture-uploads.md)

## Verification and future work

Tasks031–033 record intrinsic/cross-realm brands, source readiness, origin errors, exact low/zero-alpha image bytes, flip/PMA, ICC NONE/default behavior, source mutation, dimensions, source-canvas ordering, actual-core results and deployment/performance evidence. Browser-default color conversion records native Chrome's policy alongside exact NONE assertions.

DOM upload performance includes source extraction, helper dimension probes, snapshots, core processing, bridge, encoding and submission. Source preparation and GPU completion have separate measurements. Native helper GPU allocation/copy counters remain unavailable. WebGPU host counters cover the external-canvas copy, opaque encoding and destination upload.

Later host adapters require their own decoded-image input boundary. VideoFrame, explicit upload color-space selection, additional source encodings, context restoration and broader formats retain explicit compatibility tasks.

# Observing OffscreenCanvas compositing

Task 070 left the transferred OffscreenCanvas original failing after presentation. WebGL1 requires clearing the default attachments after an actual composition when preserveDrawingBuffer is false. A standalone OffscreenCanvas has no placeholder consumer. The GL implementation receives an OffscreenCanvas in both cases and the HTML interface does not expose its weak placeholder reference.

Keep the public factory and the pinned tests unchanged. Compare an independent standalone, a transferred detached placeholder and a transferred visible placeholder on headless hardware Chrome. Check red, transparent and depth-only writes with direct drawImage, texture identity, VideoFrame metadata, native GL and OffscreenCanvas.convertToBlob(). Record whether each observed signal is synchronous, whether it changes the presented canvas and whether a delayed response can belong to an older render. An implementation must preserve same-task drawing, ignore stale completion after resize/restore and keep standalone depth/stencil and transparent RGB. A browser-specific assumption needs separately reproducible evidence. [HTML placeholder association](https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-transfercontroltooffscreen) · [Pinned WebGL drawing buffer](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#THE_DRAWING_BUFFER)

Run the unmodified OffscreenCanvas/context-attribute-preserve-drawing-buffer file on all three backends, its HTML and standalone buffer controls, and the headless Window and Worker retention tests for any production change. Raw probes live in artifacts/conformance/campaign/default-retention.

Chrome 158.0.8127.36 on Apple Metal produced the same new GPUTexture identity after a rendering opportunity for all three kinds of OffscreenCanvas. Retaining the old handle did not identify a placeholder transfer. In the red control a direct Canvas2D copy from the standalone source still produced red; transferred detached and visible sources produced transparent black. This cannot identify a discard for initially transparent or depth-only content. VideoFrame pixel format, color metadata and allocation size also agreed for standalone and transferred canvases in each of the two color spaces, all three swap formats and both alpha modes. See offscreen-expiry.json, offscreen-image.json, source-metadata.json and source-metadata-p3.json.

In 18 independent convertToBlob probes the standalone canvas remained readable immediately and after five frames for red, all-zero and depth-only work. Both types of transferred canvas rejected after five frames with NotReadableError in all six matching scenarios. The API samples the current snapshot and returns a promise; it exposes no synchronous transfer event. In 18 timing trials each status was pending at the immediate call site. For a 1024-square standalone the three calls spent 1.2–4.0 ms before returning and 4.2–11.9 ms through PNG availability. All three transferred-canvas rejections were first observed in a microtask. The public encoding error also covers a missing readback for other reasons. Turning any such error into an unconditional GL color/depth/stencil clear can destroy valid standalone contents. Whole-frame PNG export per GL drawing cycle adds measurable work. The raw trials are blob-probe.json and blob-timing.json.

The Chrome implementation independently marks a new texture required in FinalizeFrame, even when no compositing happened, and clears its current swap texture on actual transfer. The public HTML interface stores the placeholder as an internal weak association. Chrome convertToBlob obtains a snapshot through GetImage; CanvasImageSource paths use PaintRenderingResultsToSnapshot and can supply a transparent fallback. [Chrome WebGPU presentation](https://github.com/chromium/chromium/blob/158.0.8127.36/third_party/blink/renderer/modules/webgpu/gpu_canvas_context.cc#L834-L855) · [Chrome OffscreenCanvas image access](https://github.com/chromium/chromium/blob/158.0.8127.36/third_party/blink/renderer/core/offscreencanvas/offscreen_canvas.cc#L353-L385)

## Implementation plan

The independent retained-texture experiment distinguished actual transferred OffscreenCanvas textures from standalone controls on Chrome 158 without exporting the public bitmap. Retain the actual presentation texture with COPY_SRC and a same-format standalone texture acquired in the same publish generation. After yielding, enqueue independent GPU validity probes; synchronously read a private opaque two-pixel result. Clear canonical attachments only when the public marker fails and the paired control succeeds. Treat probe failure or ambiguous expiry conservatively. Invalidate candidates on replacement, resize, disposal and explicit bitmap transfer. Coalesce observation during a synchronous group of GL operations; do not republish the public surface while merely reading. Scope validation errors to the probes. Record submission/completion and probe counters without making a stronger finish guarantee.

Verify the unchanged #599 in all backends, HTML #48 and standalone/preserve/bitmap controls, depth-only and stencil-only writes, alpha-zero RGB, consecutive frames, multiple draws in a task, foreground screenshots and Worker behavior. Measure the first cross-turn read and repeated same-turn operations independently. Record build hashes, optional platform detection and limitations.

## Implementation and results

The shared host retains one actual public presentation texture and its same-format private standalone control from the same synchronous publication. It scopes two independent copy commands to validation error scopes. Each usable source permits a constant white marker write. An expired source rejects that entire command. A read of the private two-pixel canvas must show opaque magenta for the public marker and opaque white for the control before the host resets the canonical color, depth and stencil. Magenta confirms successful initialization even if a lost canvas would return black. Ambiguous samples retain the current generation. Explicit bitmap transfer, target replacement and disposal drop both references. A subsequent microtask permits a new observation. Consecutive synchronous draws and reads share the decision. The public canvas is read only as a GPU copy source. The guard never transfers its bitmap or publishes the reset attachments to the foreground.

Headless Chrome 158.0.8127.36 on Apple Metal 3, DPR 1 and the actual Rust Wasm produced the following original assertion counts. The rows are the unchanged tests from the pinned 971-file inventory.

| Original case | Native passed/failed | JS passed/failed | Rust passed/failed |
| --- | --- | --- | --- |
| 29 Buffer offscreen | 9/0 | 9/0 | 9/0 |
| 30 Buffer preserve | 29/0 | 29/0 | 29/0 |
| 48 HTML context preservation | 4/0 | 3/1 | 3/1 |
| 599 OffscreenCanvas context preservation | 3/0 | 3/0 | 3/0 |
| 610 OffscreenCanvas bitmap transfer | 241/0 | 241/0 | 241/0 |

Task 093 documents the remaining HTML opaque direct drawImage alpha failure. The standalone and transferred OffscreenCanvas have independent coverage for nonzero RGB with alpha zero, depth-only and stencil-only first writes, same-stack draws, masked/FBO clears, a second presentation and Window/Worker execution. A direct screenshot shows that the visible placeholder stays blue after the GL back buffer is discarded. Six scene records cover 54 backend/input combinations. Both RGBA16F straight-alpha semantics and the BGRA8 opaque controls exercise actual GPU resources. Independent source-only, control-only, both-expired and forgotten-handle trials verify that only a failed source with a live control produces a discard. The checks capture uncaptured errors and explicit resource byte counts at disposal.

The standalone cost experiment measured 5 warmups then 30 wall-clock samples per group, one read after two frames per sample. Preparation and frame waits precede the timer. Each probe includes three WebGPU submits, one clear pass, four attempted copies and the synchronizing read of two private pixels. The CPU time includes any GPU wait imposed on the calling thread. The timer resolution was 0.1 ms. These samples describe a lightly loaded device.

| Surface | Format | Median ms/probe | p95 ms/probe |
| --- | --- | ---: | ---: |
| Standalone | BGRA8 | 1.7 | 2.3 |
| Visible placeholder | BGRA8 | 1.6 | 2.2 |
| Standalone | RGBA16F | 1.7 | 2.1 |
| Visible placeholder | RGBA16F | 1.6 | 2.4 |

All 64 subsequent same-stack accesses added zero GPU probes in every sample. The batch took at most 0.1 ms. The explicit scratch texture is 4 bytes for BGRA8, 8 bytes for RGBA16F, and the white marker buffer is 4 bytes. These sizes exclude WebGPU and Canvas2D context/backing overhead. Each scope pops asynchronously. The completion tracker continues to observe queue fences for the work issued by this context.

Run `pnpm check`, `pnpm ci:check`, `pnpm rust:test:wasm`, `pnpm test:chrome offscreen-discard.spec.ts offscreen-context.spec.ts worker-context.spec.ts`, and `node experiments/presentation/offscreen-discard-cost.mjs`. The official runner accepts `--include '/(context-attribute-preserve-drawing-buffer|buffer-preserve-test|buffer-offscreen-test|offscreencanvas-transfer-image-bitmap)\.html'` and `--screenshots` for each backend. Run all GPU commands headless in the exclusive campaign slot. Scene data/screenshots and raw timed samples are in `artifacts/offscreen-discard/`. The unchanged originals and per-file screenshots are in `artifacts/conformance/094-final/`. Compiler Wasm SHA-256 is `04c0a5ae77825e94f82f8b0ac97843829161c96cdbf388d2b836e1a57003cff7`. Rust Wasm SHA-256 is `e6095830f652136494b8ca6fa851f8de58a9e027a178e2b48bf6547a7e4057b1`.

WebGPU also allows an independent automatic expiry task. The relative lifetime of standalone and transferred textures was established on the recorded Chrome build. A device/runtime where both expire produces an indeterminate result and retains the canonical attachments. Re-run both independent controls and the official tests when changing Chrome or porting the browser host. [WebGPU canvas texture lifetime](https://www.w3.org/TR/webgpu/#dom-gpucanvascontext-getcurrenttexture)

## Full-clear follow-up plan

Avoid the synchronous lifetime probe when a clear fully overwrites every existing default attachment. Check WebGL color, depth and stencil write masks, actual context attachments and the scissor enable before resolving the default target. Forget only that generation and acquire a fresh pair when the new clear is presented. Preserve the ordinary observation for partial overwrites, draws, reads and framebuffer objects. Exercise native, JS and Rust on standalone and transferred canvases with all attachment combinations. Track actual probe counts, pixels and timing for repeated full and color-only frame clears. Run the required checks, the headless OffscreenCanvas tests and the original preserve/transfer files. The change is limited to BrowserHost, its focused verification and this task.

The host checks the effective attachment masks before resolving the default target. Full clears forget the old texture pair. The ordinary publish still acquires the next one. Fully masked and empty clears do no work and retain the old observation for subsequent reads. Partial color masks, scissoring, missing depth/stencil clear bits or partial stencil masks retain the synchronous check when earlier contents could contribute.

The 13 clear scenarios ran on both standalone and visible transferred surfaces for all three backends. All 78 combinations produced the specified RGBA. Full and empty/masked clears made zero probes, partial clears made one. The two public API timing groups use a 4×4 nonpreserved default framebuffer containing color, depth and stencil. The sample measures only the wall time of synchronous gl.clear after two animation frames. It includes facade, selected core, host, submission and any synchronous lifetime observation. Readback happens afterward. Each group has 5 warmups and 30 samples, with the ordinary 0.1 ms timer. The source and resources were warmed before recording.

| Surface | Backend | Full clear p50/p95 ms | Color-only clear p50/p95 ms |
| --- | --- | ---: | ---: |
| Standalone | Chrome | 0.0 / 0.0 | 0.0 / 0.1 |
| Standalone | JS | 0.3 / 0.5 | 2.2 / 2.7 |
| Standalone | Rust | 0.2 / 0.4 | 2.1 / 2.6 |
| Transferred | Chrome | 0.0 / 0.1 | 0.0 / 0.1 |
| Transferred | JS | 0.3 / 0.4 | 1.7 / 2.8 |
| Transferred | Rust | 0.3 / 0.6 | 2.4 / 2.9 |

Run `pnpm test:chrome offscreen-clear-overwrite.spec.ts offscreen-discard.spec.ts offscreen-context.spec.ts worker-context.spec.ts` in the shared headless GPU slot. Raw samples and probe counts are in `artifacts/offscreen-discard/clear-standalone.json` and `clear-transferred.json`. Zero timing samples finished inside the timer's resolution.

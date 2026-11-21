# Geometry working sets and batched canvas publication

Deliver two independent changes from main 48c9fd6. Compare one native WebGL baseline and each intermediate JS/Rust version in one headless Chrome campaign with rotated variant order.

1. Admit complete reusable draw working sets in a bounded geometry cache. Protect the current draw's resident streams before evicting older entries and skip admission of an oversized set. The initial per-context ceiling is 32 MiB and 512 entries. Keep existing immutable version keys and completion-aware retirement. Validate reuse, oversized sets, overlap, mutation, existing Buffer and draw tests, and the heavy static triangle cloud.
2. Record default framebuffer work until the existing task-end submission or explicit flush. Keep GL-internal ordered operations and read paths. Document the accepted difference for same-stack native canvas consumers. Validate explicit and automatic publication, supported readPixels, FBO rendering, and native snapshots in the declared scope. Profile uniform buffer and bind group allocation inside one encoder before adding any allocator changes.

Test the 160,000-triangle cloud and four-view Shapes alongside native on the same poses and context attributes. Use three rounds, 30 warmup frames, 120 samples, an isolated page per variant, headless hardware Chrome and the exclusive local GPU slot. Report CPU p50/p95, rAF cadence, upload bytes, submissions, passes and image comparisons. Use a separate archive of each commit to avoid changing measured source mid-run.

Run `pnpm check`, focused Chrome and original CTS cases, and `pnpm build` plus headless deployment verification. Report original test behavior affected by the accepted canvas-observation difference. Raw results will be under `artifacts/geometry-batched-publication`.

## One-campaign comparison

The same hardware Chrome process rotated native WebGL, both cores at 48c9fd6, both cores with the geometry change at 2da3da6, and both cores after publication batching at 02d4752. A fresh browser context ran each variant at the same dimensions, pose sequence and context attributes. Three rounds used 30 warmup frames and 120 sampled frames per variant. The table reports the median per-round CPU p50 / p95 in ms per frame. The interval includes animation updates, renderer work and `gl.flush()`.

| Scene / core | Native WebGL | Refral before | Geometry cache | Cache and batched publication |
| --- | ---: | ---: | ---: | ---: |
| Triangle cloud / JS | 0.475 / 0.635 | 1.440 / 2.005 | 1.580 / 1.990 | 1.270 / 1.830 |
| Triangle cloud / Rust | 0.475 / 0.635 | 1.580 / 2.025 | 2.070 / 2.690 | 1.225 / 2.235 |
| Four-view Shapes / JS | 1.585 / 2.530 | 6.830 / 7.485 | 6.860 / 7.750 | 4.490 / 4.800 |
| Four-view Shapes / Rust | 1.585 / 2.530 | 15.410 / 19.830 | 14.685 / 19.275 | 11.060 / 12.220 |

All 42 runs matched native draw counts and animation poses. At each fixed final pose, every Refral stage was pixel-exact against its baseline. The triangle cloud also matched native exactly. Shapes retained the baseline native comparison difference of at most 1,177 pixels out of 1,920,000 above a two-level RGB tolerance.

The isolated geometry change removed 38,400,000 bytes of repeated triangle-cloud uploads each frame, leaving 832 bytes. The formal comparison did not show a CPU p50 improvement in this step. Triangle-cloud timings varied across rounds, including the native control. The allocation policy also prevents an oversized draw from evicting unrelated resident streams. Exact counters and paired images identify the upload reduction independently of CPU variation.

With the geometry policy held fixed, publication batching reduced Shapes submissions from 373.18 to 1 and passes from 746.37 to 2 per frame. It lowered JS CPU p50 by about 35% and Rust by about 25%, and lowered Rust p95 from 19.275 to 12.220 ms. Bind groups increased from 58 to about 422 per frame. The complete run records these counters and the individual round timings in `artifacts/geometry-batched-publication/2026-11-21T12-15-34.750Z/`.

## Canvas API boundary

An unmodified native Canvas2D `drawImage()` after a GL draw or clear in the same call stack can observe an older or empty bitmap until Refral publishes. Explicit `gl.flush()` or the automatic microtask publishes the current drawing. The regression uses a red first publication, a green same-stack observation before and after flush, and a blue automatic publication across the microtask checkpoint. The native reference observes green immediately. GL `readPixels` and library-recognized texture-source and bitmap-transfer paths have their own ordered submission boundary. [WebGL drawing buffer](https://registry.khronos.org/webgl/specs/latest/1.0/#THE_DRAWING_BUFFER) · [Chromium canvas source snapshot](https://chromium.googlesource.com/chromium/src/+/dbe040ad387cd91cfd38b5d1a506db859c276dd2/third_party/blink/renderer/core/html/canvas/html_canvas_element.cc#1969)

## Verification

`pnpm check`, 220 headless Chrome tests, `pnpm build` and the built deployment suite passed. The production comparison includes 112 pinned official files spanning canvas, context, buffers, extensions, OffscreenCanvas and rendering. Native passed 110, retaining its two existing method-enumeration failures. Both Refral cores passed 103. In the preceding full checkpoint the same 112 files had 110 passes, one failure and one timeout per Refral core.

The original `many-draw-calls.html` completed all 12 assertions on both cores. Elapsed time was 6.11 seconds on JS and 12.76 seconds on Rust. The old timeout remains in the preceding checkpoint's evidence.

Eight prior-pass files now fail on the declared synchronous canvas snapshot difference. The preserve-drawing-buffer file retains its existing post-composite failure and adds one synchronous snapshot failure. In a separate archive, a test-only bootstrap inserted `flush()` before native Canvas2D copies and `toDataURL()` on recognized Refral canvases. This restored all eight prior passes and returned the preserve case to its original 3/1 assertion result. Upstream scripts and assertions were unchanged in both runs.

| Original index and file | Failed assertions per core after batching | With explicit flush control |
| --- | ---: | ---: |
| 31 `canvas/canvas-test.html` | 1 | 0 |
| 36 `canvas/draw-webgl-to-canvas-test.html` | 30 | 0 |
| 37 `canvas/draw-static-webgl-to-multiple-canvas-test.html` | 90 | 0 |
| 43 `canvas/to-data-url-test.html` | 45 | 0 |
| 46 `canvas/webgl-to-2d-canvas.html` | 8 | 0 |
| 48 `context/context-attribute-preserve-drawing-buffer.html` | 2 | 1 |
| 56 `context/context-hidden-alpha.html` | 4 | 0 |
| 65 `context/premultiplyalpha-test.html` | 8 | 0 |
| 636 `rendering/clear-default-framebuffer-with-scissor-test.html` | 1 | 0 |

Production original results and images are in `artifacts/geometry-batched-publication/cts/`. The explicit flush control is in `artifacts/geometry-batched-publication/cts-explicit-flush/` with its harness patch in `artifacts/geometry-batched-publication/flush-control.patch`.

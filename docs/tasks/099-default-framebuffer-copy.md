# 099. Single-pass default framebuffer color publication

## Goal and contract

Reduce host work for common default-framebuffer triangle draws while keeping the WebGL call synchronous and visible to external native Canvas2D immediately on return. Use the same selected JS or Rust core, compiled ESSL, GPU executor and unchanged original tests. Base this experiment on 094's transferred OffscreenCanvas observation and full-clear fast path.

## Owned scope and plan

The browser host owns texture allocation, storage orientation, raster encoding and DOM presentation. For eligible RGBA8/BGRA8 HTML surfaces, draw in presentation orientation to private renderable storage, then copy it to the canvas in the same submission. GL readback, framebuffer copies and draws with different depth/stencil requirements must materialize canonical GL rows in submission order. Keep the existing pipeline for retained/Offscreen surfaces, required non-premultiplied alpha conversion, points/lines and other unsupported fast-path states. Use ANGLE's existing flipXY driver field and WebGPU viewport, scissor and winding for screen coordinates. Distinguish displayed storage, logical buffer discard and queued resource lifetime across resize/dispose. Evaluate per-draw swap lookup separately where necessary.

## Acceptance

- Run pnpm check, actual Rust Wasm tests and single-worker headless Chrome.
- Compare same-task external Canvas2D copies and immediate GL readPixels with native for lower/upper pixels, alpha, viewports, scissoring, winding/gl_FragCoord, blends and fallback transitions. Exercise partial clears, depth/stencil/point draws, default-to-FBO copies, hidden/visible changes and resize. Verify the retained and Offscreen fallback.
- Assert real GPU pass/copy/submit counts for eligible and fallback calls. Run hardware captures with actual cores and save screenshots, environment, raw timings and the unmodified 656 submission. Preserve 5s, upstream 20s and extended observations as distinct policies.
- Only deliver a production optimization if ordered GPU resources and visible behavior agree and real hardware demonstrates a benefit; record reproducible failures or representation limits separately.

### Second candidate

Keep canonical GL rasterization for every primitive. Test a compute pass that copies the canonical color image to the public swap texture with integer texel coordinates and a Y flip. Restrict it to non-retained HTML RGBA8 surfaces or BGRA8 with the advertised storage feature; keep converted-alpha and Offscreen surfaces on their existing render path. Compare against the same hardware workload with unchanged origination, capture and delivery timeouts. Reject the change if transfer overhead or the post-frame delay does not improve.

### Surface lookup control

Keep rasterization and the normal display blit unchanged. Measure repeated GPUCanvasContext.getCurrentTexture calls separately from the cost of the GL draw and presentation submission. In a short-lived HTML-only prototype, reuse the swap texture until the next microtask. Observe width and height changes synchronously with MutationObserver.takeRecords, including same-dimension assignments. Validate native Canvas2D observation after consecutive publications, resize, hidden surfaces and the pixel-center and target transitions above before exercising the cold original.

## Measured candidates on Chrome 158.0.8127.36

The source baseline is `4b487b7`. It includes the task 092 buffer/view work and task 094 OffscreenCanvas changes. The browser ran headless with the Apple M4 Max / Metal hardware adapter. All original runs acquired the shared GPU slot for one backend at a time. Raw samples, source patches, configuration and screenshots are under `artifacts/conformance/campaign/default-color-publication/`.

The reflected-raster experiment drew eligible triangles into a displayed-row texture and copied that texture to the swap chain. At 8×8 it changed source pixels 9–13 on one sample-centered horizontal edge and 49–53 on the opposing edge when an always-passing depth test switched rendering paths. Both cores exhibited the change. Native preserved every pixel. GLES polygon rasterization requires exactly one owning polygon on every shared edge sample. The regression uses additive blending to distinguish zero, one and two fragment contributions at each shared pixel center. [GLES 2.0.25 §3.5.1](https://registry.khronos.org/OpenGL/specs/es/2.0/es_full_spec_2.0.pdf)

The compute experiment preserved the GL raster orientation for every draw. It replaced the presentation triangle with a compute dispatch that loaded a canonical texel at `(x, height-1-y)` and stored it at `(x, y)` on the public normalized HTML surface. Retained surfaces, OffscreenCanvas and straight-alpha conversion continued to use the existing blit. The focused browser run passed 11/11, including same-task native Canvas2D, GL readback and the three pixel-center controls.

The 256×256 workload runs the original shaders and offset changes with two successive 10,000-draw batches after shorter batches. CPU covers public GL calls through flush; the following interval covers the immediate Canvas2D snapshot and GPU completion. Values are milliseconds per batch. These are paired observations from single hardware runs.

| Path | JS CPU | Rust CPU | JS snapshot and fence | Rust snapshot and fence |
| --- | --- | --- | --- | --- |
| Task 092 original render blit | 331.0, 324.9 | 323.6, 318.0 | 86.6, 152.9 | 89.3, 164.0 |
| Reflected raster and texture copy | 289.9, 290.8 | 288.5, 287.9 | 81.6, 83.7 | 72.0, 90.8 |
| Canonical raster and compute copy | 304.4, 299.7 | 294.5, 290.4 | 80.0, 79.7 | 85.0, 92.5 |

The reflected-raster Rust cold run used the historical 5-second inactivity setting. Both official attempts recorded 10 assertions passed and zero failed before page-health timeouts at 35.550 and 35.007 seconds. The compute-copy JS cold run used the upstream 20-second inactivity setting. Both attempts recorded 10 passed and zero failed before page-health timeouts at 34.558 and 34.545 seconds. Each command retained its regular 30-second health checks, 600-second absolute watchdog, original case and original epilogue. Neither result reached upstream completion. The last available case-specific images in both runs are labelled as in-progress.

### Swap acquisition control and completion traffic

A control reused a single HTML swap texture until the next microtask, observing width/height attribute changes with MutationObserver.takeRecords(). It reduced 20,002 surface lookups to one per 10,000-draw batch. Fourteen focused checks passed, including consecutive red/green/blue native Canvas2D observations and a width change followed by restoration in the same call stack. CPU through flush was 321.3/319.2 ms for JS and 320.5/315.2 ms for Rust. A narrower control taking one lookup per draw measured 323.4/322.9 and 317.2/311.3 ms respectively. Both retained the same 10,001 real queue submissions per batch. The additional cache lifetime and observer did not address the measured bottleneck. Same-size assignments require independent default-buffer handling in task 100.

The integrated renderer trace captured 6,010 Dawn ProcessEvents tasks occupying 38.783 s of the 39.022 s immediately after the upstream epilogue request. In Chrome 158's Dawn revision, the wire client creates an internal WorkDoneEvent after each queue submission, including submissions made without an application completion callback. Removing a raster pass or acquiring fewer swap textures leaves that stream intact. A real Canvas2D consumer may snapshot after any public GL draw and observe a fresh pixel immediately. Deferring those GPU draws to a later task would change that behavior. The source copy, trace and timing analysis are under `artifacts/conformance/campaign/draw-completion-trace/`. [Dawn Queue.cpp at the Chrome revision](https://dawn.googlesource.com/dawn/+/6e24542436a3ef58d4a1110f01712da9afbff3e3/src/dawn/wire/client/Queue.cpp#104)

The delivery retains the shared-edge regression. The host continues to use its original raster and presentation path. Reproduce the three-backend regression with `REFRAL_HEADLESS=1 pnpm test:chrome tests/chrome/default-raster-coverage.spec.ts`. It writes the six actual 8×8 readback images under `artifacts/differential/default-raster-coverage/` before checking the shared-edge values.

On the swap-cache prototype, the cold original `conformance/canvas/render-after-resize-test.html` (#41) recorded 11 passed assertions for native, and 8 passed/3 failed for each Refral core. Those three checks exercise no-op resize and match the pre-100 baseline. See `epoch-resize`. Task 100 tracks the separate default-buffer lifetime fix.

On the reflected prototype the new shared-edge regression observed red intensities [0,0,0,0] with the upper triangle first and [128,128,128,128] with the lower triangle first on both Refral cores. Native returned [64,64,64,64] in both orders. `reflected-shared-edge-images/` contains the original six readback PNGs. Each is stored top-down at the actual 8×8 resolution.

On the delivered canonical host, all three backends passed the shared-edge regression and produced [64,64,64,64] in both orders. See `accepted-shared-edge.log` and `accepted-shared-edge-images/`. Public host behavior is unchanged. The deterministic suite passed 243 Vitest cases, the tool tests, 76 native Rust tests and the support matrix. The real Wasm binary passed 55 integration checks.

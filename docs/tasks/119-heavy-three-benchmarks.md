# Heavier Three.js rendering benchmarks

Compare native WebGL1, Refral JS and Refral Rust at main 2f82339 and establish the next geometry, draw and framebuffer optimization priorities. Scope is the optional benchmark and its evidence.

- Extend the Shapes example to four scissored views of the same textured scene to increase draw count with shared static geometry.
- Adapt the pinned Three.js BufferGeometry example with its 160,000 static lit transparent triangles, deterministic inputs and a rotating transform.
- Adapt the pinned Three.js Sobel example at 1920 × 1080. Keep the lit mesh, luminosity and Sobel passes, use RGBA8 intermediate textures on all paths, and animate the mesh. Also sample 960 × 540 to separate screen area from fixed work.

Use the existing Three.js r162 dependency, scene resources and WebGL1 context selection. Use headless Chrome with an isolated profile and one GPU worker. Rotate backend order across three rounds. Collect the same poses, draw counts, three final images, CPU percentiles, rAF intervals, first-image timings and available Host counters. Record same-frame pixel differences. A diagnostic control can change one runtime policy on a separate build to attribute a measured cost.

Acceptance uses `pnpm check` and `pnpm bench:three:heavy`. Raw frames, Chrome configuration and images go in `artifacts/three-heavy/`. Keep distinct measurements for renderer CPU work, observed animation cadence and any later GPU timings. Record optimization recommendations against the measured source and matching outputs.

## Workloads and sampling

Four-view Shapes shares textures, materials and geometry across four scissored views at 1600 × 1200. The cloud follows the upstream two-sided transparent Phong scene at 1280 × 720. Seeded input replaces ambient randomness. The Sobel adaptation uses the upstream luminosity and Sobel shaders on a rotating torus knot with RGBA8 intermediate targets. [Pinned Three.js Shapes](https://github.com/mrdoob/three.js/blob/ef80ac74e6716a50104a57d8add6c8a950bff8d7/examples/webgl_geometry_shapes.html) · [Pinned BufferGeometry](https://github.com/mrdoob/three.js/blob/ef80ac74e6716a50104a57d8add6c8a950bff8d7/examples/webgl_buffergeometry.html) · [Pinned Sobel](https://github.com/mrdoob/three.js/blob/ef80ac74e6716a50104a57d8add6c8a950bff8d7/examples/webgl_postprocessing_sobel.html)

Three rounds rotated the backends on headless Chrome 158.0.8127.36 with Apple M4 Max Metal. Every run captured an initial image, warmed up for 30 frames and sampled 120 frames at fixed animation times. CPU values are medians of three per-round percentiles and cover animation updates, Three.js rendering and `gl.flush()`. The timer quantum was 0.005 ms. The rAF interval measures browser callback cadence. GPU timings are outside these metrics.

| Scene | Draw calls / submitted triangles | Native CPU p50 / p95 | JS CPU p50 / p95 | Rust CPU p50 / p95 |
| --- | ---: | ---: | ---: | ---: |
| Shapes, four views | 369 / 34,592 | 0.615 / 0.770 | 7.100 / 7.945 | 15.055 / 19.685 |
| Triangle cloud | 2 / 320,000 | 0.160 / 0.285 | 1.110 / 1.290 | 1.225 / 1.515 |
| Sobel, 1920 × 1080 | 3 / 16,386 | 0.225 / 0.395 | 0.875 / 1.475 | 0.905 / 2.480 |
| Sobel, 960 × 540 | 3 / 16,386 | 0.255 / 0.450 | 0.665 / 1.465 | 1.050 / 2.145 |

CPU timing units are ms per frame. Refral submits about 373 times per Shapes frame and records about 746 passes. Rust Shapes rAF p95 reaches 33.33 ms. Other measured rAF p95 values stay near 16.67 ms. The triangle cloud uploads 38,400,832 bytes per Refral frame. The three static streams are 5.76, 5.76 and 7.68 MB. Their access order exceeds the current 8 MiB cache and evicts the previous stream before reuse. Sobel records two submissions and six passes per Refral frame at both resolutions.

All 36 runs passed. Three backends execute identical draw workloads in each scene. JS and Rust final pixels match byte for byte. Native also matches for the triangle cloud and both Sobel resolutions. The largest native Shapes difference is 1,177 of 1,920,000 pixels above a two-level RGB tolerance. Raw frames, image comparisons, startup timings, adapter identity and Chrome flags are in `artifacts/three-heavy/2026-11-21T11-59-48.135Z/`.

Native / JS / Rust first-image medians are 59.68 / 143.12 / 177.55 ms for four-view Shapes, 58.44 / 111.85 / 110.86 ms for the cloud, and 27.65 / 81.73 / 122.00 ms for 1080p Sobel. The boundary runs from context creation to the first resolved `createImageBitmap()` and includes scene setup and the first rAF wait. The native timer-query extension was available. The Refral WebGPU device did not enable `timestamp-query`.

## Diagnostic controls

Each control was run for three more rounds in an isolated source archive with the same sample counts and sequence. The production and control workloads and final images were byte-exact in all 18 matched pairs. The controls ran after the baseline and have independent startup and scheduling variation. The upload and submission counters identify the effect of each single change directly.

| Control | Work removed | JS CPU p50 / p95 | Rust CPU p50 / p95 |
| --- | --- | ---: | ---: |
| Cloud with 32 MiB geometry cache | 38,400,832 to 832 uploaded bytes/frame | 1.110 / 1.290 → 0.625 / 1.005 | 1.225 / 1.515 → 0.785 / 1.750 |
| Shapes publishes on explicit flush | About 373 to 1 submissions and 746 to 2 passes/frame | 7.100 / 7.945 → 4.595 / 4.920 | 15.055 / 19.685 → 11.470 / 13.020 |

The cloud control retains 19.2 MB of static geometry. Its steady uploads consist of 832 bytes of other data. Rust p50 improves in the control and its measured p95 rises. Shapes' batched rAF p95 is 16.67 ms for both cores. Bind groups rise from 58 to about 422 per frame because many per-draw uniform values now coexist in one encoder. The current uniform group reuse path can safely overwrite a Buffer only after the prior draw has been submitted.

The capacity and publication patches, raw samples, screenshots and an exact comparison record are in `artifacts/three-heavy/controls/`. The immutable case patches are described in each control's `control.json`. Apply the controls independently and run `REFRAL_HEAVY_SCENES=triangle-cloud pnpm bench:three:heavy` or `REFRAL_HEAVY_SCENES=shapes-four pnpm bench:three:heavy` in that source archive to reproduce them.

## Optimization priorities

1. Preserve whole static geometry working sets when they fit the memory budget. Group admission and eviction by the draw's reusable streams and check resident bytes and eviction rate. Include a larger-than-budget case before selecting a cache budget. The capacity experiment identifies the repeated upload cost.
2. Separate default canvas publication from the remaining many-draw CPU overhead. Explicit frame-boundary batching is a candidate where the caller owns canvas observation. Same-task DOM copies can observe older pixels with deferred publication. Profile Rust API dispatch and transport with the same commands and shared host. Test uniform suballocation within an encoder to address the measured increase in per-draw bind groups. [Same-task canvas observation](104-submission-batching-control.md#external-pixel-control)
3. Measure completed GPU work before tuning Sobel or general fragment throughput. The task's 4× pixel-area control retains comparable CPU medians and 60 Hz observed rAF cadence, with fixed Host pass and submission counts.

`pnpm check` passed, including 243 deterministic JS tests and 77 native Rust tests. The optional headless benchmark passed 36 baseline runs and 18 control runs.

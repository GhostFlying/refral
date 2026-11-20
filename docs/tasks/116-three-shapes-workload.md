# Three.js Shapes performance workload

Adapt the official Three.js r162 Shapes example at commit ef80ac74e6716a50104a57d8add6c8a950bff8d7 to exercise the same engine, scene and camera on native WebGL1, Refral JS and Refral Rust/Wasm. Three.js r162 supplies a WebGL1 renderer. Use the same resolution, pixel ratio, context attributes and deterministic rotation sequence across the three paths. Retain the upstream license, scene provenance, and document adaptations.

The demo owns scene setup and backend selection. The optional performance runner owns fixed samples, browser and adapter evidence, Three.js draw counters, pixel comparison and timing. Keep warmup, CPU frame time and completed-shape image evidence distinct. Use one headless Chrome worker. Diagnose any real semantic gap found by the application before comparing samples.

Acceptance uses pnpm check, pnpm build, three headless first images and the dedicated performance command. Save raw samples and images under artifacts/three-shapes. Keep scene setup outside steady-state timing and report any observable rendering difference before interpreting measurements.

## Adaptation and provenance

The scene retains the r162 example's geometry, camera, point light, Phong materials and UV grid image. The repo pins the engine to npm three 0.162.0 and preserves the upstream MIT notice next to the adapted scene. The UV grid image SHA-256 is `909d9a1eb2a5d5de9d221a5e8de4e9119d409decddf522d48896bd51523d354d`. The adaptation uses an explicit WebGL1 context, disables antialiasing consistently, fixes rendering to 800 × 600 at DPR 1 and replaces the live Stats overlay with a backend selector. The interactive page still supports drag rotation. [Pinned scene](https://github.com/mrdoob/three.js/blob/ef80ac74e6716a50104a57d8add6c8a950bff8d7/examples/webgl_geometry_shapes.html) · [Pinned UV grid](https://github.com/mrdoob/three.js/blob/ef80ac74e6716a50104a57d8add6c8a950bff8d7/examples/textures/uv_grid_opengl.jpg) · [WebGL1 removal in r163](https://github.com/mrdoob/three.js/wiki/Migration-Guide#162--r163)

## Measured run

Headless Chrome 158.0.8127.36 on Apple M4 Max and the Metal3 adapter. One worker ran three rounds with rotating backend order. Each run had 30 warmup frames and 120 measured frames along the same deterministic rotation. All three reported identical per-frame work, including 92–93 draw calls, 8,648 triangles, 1,309 lines and 1,287–1,339 points.

| Backend | CPU p50, ms/frame | CPU p95, ms/frame | First-frame CPU, ms | Observed rAF callbacks/s |
| --- | ---: | ---: | ---: | ---: |
| Native WebGL1 | 0.37 | 0.56 | 25.9 | 60.0 |
| Refral JS | 3.30 | 3.89 | 97.0 | 60.0 |
| Refral Rust/Wasm | 5.61 | 6.34 | 102.3 | 60.0 |

The table takes the median of each statistic across three rounds. CPU time measures the Three.js render call and gl.flush, including CPU-side browser host encoding and submission. Context and scene initialization are recorded separately. The rAF cadence includes refresh pacing and scheduling. GPU execution time and maximum throughput were not measured. The shared Refral host reported 93.42 queue submissions and 186.83 passes per frame on both cores. The native submission count is unavailable.

The fixed comparison frame was byte-identical across JS and Rust on all three rounds. Against native, 214 of 480,000 pixels exceeded the per-channel tolerance of 2 on each core. The nine headless benchmark runs, deterministic checks, production build and deployment checks passed. Built preview also passed backend link selection and drag rotation. Raw samples, metadata, image comparisons and screenshots are under `artifacts/three-shapes/2026-11-20T09-12-46.509Z`. Run with `REFRAL_HEADLESS=1 pnpm bench:three`.

# Large Three.js scenes for CPU attribution

Start from main 538c30a. Evaluate two contrasting examples at the existing Three.js r162 revision. The individual-mesh Suzanne path stresses repeated draws over shared indexed geometry, with 1,000 and 3,000 objects at a fixed resolution. The shadow-map herd combines an animated GLTF mesh, grouped morph animation and shadow/main passes. Keep any unsupported workload and first failure visible. Select a supported second workload if necessary.

Own optional benchmark scenes, pinned fixture acquisition, the heavy benchmark selector, and the evidence record. Use identical deterministic camera motion, transforms, resources and time across native/JS/Rust. Require the existing work and image gates and record the hardware adapter, actual core, counters and raw frames. Compare against Shapes, then run a separate headless attribution experiment on the largest supported case. Use the exclusive GPU lock. Run pnpm check, pnpm ci:check, the affected benchmark and verify delivery via the required PR check.

## Reproduction

After the normal compiler and Rust/Wasm builds, run `pnpm bench:three:large`. The command verifies the pinned model and runs Shapes plus the three new workloads in headless Chrome on one worker. For a short smoke use `REFRAL_HEAVY_ROUNDS=1 REFRAL_HEAVY_WARMUP=6 REFRAL_HEAVY_SAMPLES=10 pnpm bench:three:large`. Results and three-route PNGs are indexed in `artifacts/three-heavy/latest.txt`. For a subset, prepare the model with `node --use-env-proxy tools/deps-three-scenes.mjs` and use the existing `REFRAL_HEAVY_SCENES` selector with `pnpm bench:three:heavy`.

- [Three.js r162 instancing performance](https://github.com/mrdoob/three.js/blob/ef80ac74e6716a50104a57d8add6c8a950bff8d7/examples/webgl_instancing_performance.html) supplies the NAIVE path. Each mesh uses the same 505-vertex, 2,901-index Suzanne geometry and normal material. The two sizes share the same seeded prefix and a deterministic orbit. Native frustum culling stays enabled on all routes.
- [Three.js r162 interactive cubes](https://github.com/mrdoob/three.js/blob/ef80ac74e6716a50104a57d8add6c8a950bff8d7/examples/webgl_interactive_cubes.html) supplies the 2,000 meshes, separate Lambert materials, directional light, orbit and raycast highlight. The benchmark fixes the pointer at the center and increases the orbit radius from 5 to 50 to keep most meshes visible. Each cube uses 36 indices. The two examples use the harness's single-sample WebGL1 context, DPR 1 and a 1280 × 720 drawing buffer.

## Hardware baseline

The November 26, 2026 run used headless Chrome 158.0.8127.88, Apple M4 Max, native ANGLE/Metal and the non-fallback Apple metal-3 WebGPU adapter. Each route rendered a first image, 30 warmup frames and 120 measured frames per round. The three rounds rotated backend order. Time advances by a fixed 1/60 second per rendered frame. CPU time includes animation, raycast where applicable, Three.js, GL processing, encoding and the return from `gl.flush()`. It excludes RAF pacing, the capture and waiting for GPU completion. Timer resolution was approximately 0.005 ms. Each cell below gives the median of three round-level p50s and p95s in ms/frame.

| Scene | Visible draws p50 | Triangles p50 | Native p50 / p95 | JS p50 / p95 | Rust p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| shapes-four | 369 | 34,592 | 0.560 / 0.695 | 2.585 / 3.000 | 2.375 / 2.875 |
| suzanne-1000 | 872 | 843,224 | 0.675 / 1.800 | 7.270 / 7.820 | 5.155 / 5.640 |
| suzanne-3000 | 2,596 | 2,510,332 | 2.065 / 2.315 | 20.315 / 22.300 | 13.695 / 14.790 |
| interactive-cubes | 2,000 | 24,000 | 2.390 / 2.915 | 10.610 / 11.130 | 9.735 / 10.450 |

All 36 page runs passed. Every measured frame matched the native draw and primitive counts. The final captures for all three new workloads were byte-identical on all three routes in each round. The Shapes reference passed its existing native tolerance. The environment, build hashes, per-frame timings and PNGs are under `artifacts/three-heavy/2026-11-26T11-59-41.198Z/`.

## Index-validation control

Each Suzanne draws the same range of 2,901 indices. The JS and Rust semantic cores scan that range on every indexed draw to find the highest referenced vertex for attribute bounds checking. At the observed median visible draw count this reads 7,530,996 indices per Suzanne 3,000 frame. Cubes uses only 36 indices per draw, or 72,000 for 2,000 draws.

An isolated candidate cached one successful extent per element buffer and reused it only for the same storage/content version, index type, byte offset and count. All other validation and drawing followed the original path. Fresh pages alternated native, both baseline cores and both diagnostic cores over three rounds, with 30 warmup and 120 measured frames per page. The two builds shared the scene sources and compiler. This experiment is archived separately from runtime code.

| Scene | Route | Native p50 / p95 | Main p50 / p95 | Range reuse p50 / p95 | Paired p50 gains, rounds 1 / 2 / 3 (ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| suzanne-3000 | js | 2.290 / 4.985 | 20.400 / 22.370 | 10.085 / 11.005 | +10.315 / +11.785 / +9.825 |
| suzanne-3000 | rust | 2.290 / 4.985 | 13.405 / 14.340 | 10.630 / 11.440 | +2.365 / +3.115 / +2.450 |
| interactive-cubes | js | 2.450 / 5.185 | 10.595 / 11.235 | 10.480 / 11.220 | -0.210 / +0.190 / +0.095 |
| interactive-cubes | rust | 2.450 / 5.185 | 9.520 / 10.145 | 9.525 / 10.275 | -0.205 / +0.110 / +0.030 |

All candidate captures exactly matched the corresponding baseline. Each measured workload sequence matched native. Per-frame host draw, submission, pass, copy, upload, new pipeline and new bind-group counters matched between the control and candidate. The local experiment sources, method and driver are `artifacts/large-scenes/patch.py` and `compare.mjs`, with all 30 captures, raw frame samples, build hashes and per-round comparisons under `artifacts/large-scenes/2026-11-26T12-01-46.123Z/`.

The long-index case improved p50 and p95 for both cores in all three paired rounds. For the short-index material-heavy scene, p50 gains changed sign and no consistent improvement emerged. Both scenes still cost about 10 ms of CPU per frame on the diagnostic Refral routes. Further attribution of the remaining per-draw, material, uniform and host work needs separate controls. Productionizing the range cache would require invalidation coverage for buffer redefinition, subdata writes, alternating draw ranges and index types, object lifetimes, and preservation of bounds errors after a vertex buffer shrinks.

## Compatibility probes

The adapted [shadow-map performance example](https://github.com/mrdoob/three.js/blob/ef80ac74e6716a50104a57d8add6c8a950bff8d7/examples/webgl_shadowmap_performance.html) rendered with native WebGL. Both Refral cores stopped at the shared compiler's vertex attribute limit with the original morph slots. A diagnostic two-slot version reached a separate ANGLE struct-declaration error involving `IncidentLight_0` and `DirectionalLightShadow_0`. The corresponding scene sources and errors are under `artifacts/large-scenes/{full-morph.ts,two-morph.ts,smoke.log,smoke-herd.log}`.

The [100,000 point sprites](https://github.com/mrdoob/three.js/blob/ef80ac74e6716a50104a57d8add6c8a950bff8d7/examples/webgl_buffergeometry_custom_attributes_particles.html) ran on all routes. JS and Rust agreed exactly. Against native, 1.9834% of pixels exceeded two RGB levels in the smoke capture, above the existing 0.2% threshold. Keep this as an open image discrepancy. Its samples are excluded from performance conclusions. The adapted source is in `artifacts/large-scenes/with-particles.ts` and the PNGs and comparison are in `artifacts/three-heavy/2026-11-26T11-55-45.476Z/`.

## Verification

The fresh fixture download matched the pinned SHA-256 and the existing cached bytes. Local `pnpm check` and `pnpm ci:check` passed, including 245 unit, 76 tooling and 77 native Rust tests. Only the optional workload, fixture acquisition, benchmark validation and documentation are delivered. The cache experiment used an archived JS source tree and a separate compiled Wasm.

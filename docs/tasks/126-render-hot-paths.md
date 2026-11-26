# Reduce per-draw CPU costs on the heavy Three.js scenes

Start from dec0dcc, the default Rust command buffer. Measure each change independently on the same hardware and verify the actual core, workload, and pixels.

1. Return the JS current program directly after the context-loss guard. Preserve the program binding, retirement, wrapper identity and error order.
2. Add frontFace to the optional Rust batch numeric instructions. Select the instruction from a module capability at initialization. Preserve synchronous queries and errors and draw-time winding. Exercise the previous batch module and the older per-call module with the new reader.
3. Experiment with reusing prepared vertex layouts in the shared host. Only retain a change with reproducible whole-frame benefit and dependency-safe resource ownership.

The JS core, Rust batch adapter and decoder, their regressions, and shared host drawing are in scope. Use pnpm check, pnpm ci:check, pnpm rust:build, pnpm rust:test:wasm, the headless Chrome regression suite, production deployment check and targeted original conformance files. Archive each benchmark tree and its release module. Interleave native, JS and Rust on four-view Shapes and Triangle Cloud with 30 warmup frames and 120 samples per round. Report CPU p50 and p95 in ms per frame, replays, submissions and image comparisons. Raw evidence belongs in artifacts/render-hot-paths/.

## Implementation and compatibility

The JS retirement path reads CURRENT_PROGRAM after the context-loss guard without materializing unrelated query results. The Rust writer selects its numeric command table once when opening the arena. Batch v1 modules that advertise opcode 28 replay frontFace through the existing Rust validator. Previous ABI7 modules retain their existing transport. The release module grew from 366,129 to 366,182 bytes. Alternate winding, an invalid enum between draws, preserved state, and the next synchronous query are covered by the actual-Wasm fixture.

The host experiment retains one prepared layout per linked program and texture-layout variant. It matches the ordered attribute locations and shader types and the point-instancing mode. It retains descriptor metadata only. The pipeline key includes the primitive mode and the ordered layout signature. Geometry, buffer versions, dynamic state and GPU resource retirement continue through the existing draw path.

## Per-stage comparison

Apple M4 Max, hardware Metal, headless Chrome 158.0.8127.88, one GPU worker, DPR 1. Four interleaved rounds used 30 warmup frames and 120 measured frames per scene and variant. Each table entry is the median of the four per-round CPU p50 / p95 values in ms per frame. The timing includes scene update, Three.js render and explicit flush. rAF waits, captures and GPU completion waits are outside the interval. The timer quantum was 0.005 ms. Each cell comes from an independently measured route. The repeat columns use the exact step-two build in separate pages.

| Scene and core | Native WebGL | Baseline | Direct current program | Also batch winding | Also reuse vertex layouts | Step two repeat |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Four-view Shapes, JS | 0.780 / 1.732 | 4.285 / 4.803 | 2.730 / 3.392 | 2.775 / 3.805 | 2.488 / 2.890 | 2.972 / 3.742 |
| Four-view Shapes, Rust | 0.780 / 1.732 | 2.312 / 3.003 | 2.435 / 3.040 | 2.335 / 2.825 | 2.252 / 2.575 | 2.708 / 3.353 |
| Triangle Cloud, JS | 0.183 / 0.387 | 0.400 / 0.770 | 0.363 / 0.970 | 0.348 / 0.632 | 0.410 / 0.815 | 0.382 / 0.772 |
| Triangle Cloud, Rust | 0.183 / 0.387 | 0.550 / 1.033 | 0.427 / 0.740 | 0.402 / 0.812 | 0.447 / 1.165 | 0.500 / 1.130 |

The JS program lookup reduced Shapes p50 and p95 in all four rounds. The layout change also reduced both JS percentiles in all four rounds against each independent step-two control. Shapes Rust improved in three of four rounds against the first control. The two-draw, 320,000-triangle cloud went from 11 Rust commands across three replays to 13 commands in one replay, retaining one GPU submission. Comparing the immediate parent and winding change, Rust CPU p50 improved in three rounds and p95 in two. The independent step-two repeats show significant page-to-page variability on this scene.

Across 88 page runs the work sequence matched native. Final captures were byte-exact across JS, Rust and all Refral stages. At most 0.0614% of pixels differed from native by more than two levels in any RGB channel. The baseline and JS-only revision used Wasm SHA-256 62cc4f7394d3567252eefac6aa149ee5b26fa7f92f30c23f53fd0cec986b44a9. All later stages used 3fa95aba2510c8ba07ca2f1858588fd33278b387437deabff666c3996cd524c1. The measured host source has SHA-256 b8ed01b107783a585bb4d82cb0ceda85c652712b21a9ebbe94a20d2fd619f193.

Run the standard workload on any built revision with `REFRAL_HEAVY_SCENES=shapes-four,triangle-cloud REFRAL_HEAVY_ROUNDS=4 pnpm bench:three:heavy`. Local per-revision archives, the interleaved driver, final PNGs, counters, raw frames and round-level comparisons are under `artifacts/render-hot-paths/`. The main comparison is in `2026-11-26T11-18-21.267Z/summary.json`.

## Regression checks

The full headless Chrome suite passed 225/225. The current release module, the previous batch-v1 module, and the pre-batch ABI7 module each passed 59/59 actual-Wasm tests. Deterministic checks, native Rust tests and the packaged Chrome deployment passed. The targeted original CTS selection contained 48 files. Native passed 48, JS and Rust each passed 47. The previous 46 files matched the recorded outcomes and assertion counts on all three routes. The existing failure in clear-default-framebuffer-with-scissor-test.html concerns same-stack observation of a drawn canvas through Canvas2D. Both added files completed on all routes, with 13 passing assertions for program-handling.html and 17 for culling.html. Per-file results and screenshots are in `artifacts/render-hot-paths/cts/`.

## Attribution controls

In a separate three-round Shapes run with 75 measured frames per route, timing surrounded program-resource selection through prepared pipeline lookup. The median of round p50s fell from 0.335 to 0.240 ms for JS and from 0.320 to 0.235 ms for Rust. Both improved in every round. The measured steady state went from 369.13 vertex-layout constructions per frame to zero on both cores. Draws and other GPU work matched. These instrumented intervals have their own timer overhead and are reported separately from the main table.

A second Triangle Cloud check alternated the original and prepared-layout draw methods within the same page, sharing the scene, Wasm and device. It rotated the four-frame ABBA sequence by round, warmed both methods for 40 frames, and measured 120 frames per method in each of four rounds. It created zero pipelines during sampling. JS p50 / p95 was 0.440 / 1.198 ms before and 0.443 / 1.170 after. Rust was 0.388 / 0.803 before and 0.390 / 0.815 after. The per-round tail deltas had mixed signs on both cores. The separate-page Triangle Cloud slowdown did not reproduce consistently under this paired control. Accept layout reuse for its measured multi-draw benefit. Single-scene timing remains hardware and workload specific.

Raw diagnostic samples and the paired comparisons are indexed by `phase.txt` and `cross.txt` in the evidence directory. The phase probes and alternating draw method were applied to archived checkouts only.

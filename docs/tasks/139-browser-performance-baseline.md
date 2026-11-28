# 139 Frozen browser performance baseline v1

Freeze eight browser workloads before optimizing another draw path. Own the optional benchmark command, campaign reporting and this record, not the renderers, workload implementations or required CI. Use the pinned fixtures and existing timing boundaries from tasks 127, 130, 131 and 137. Node/ANGLE-on-Dawn is an unchanged external reference (task 138), not a target or an eight-scene route.

1. Pin the selectors, routes, rounds and work/image checks behind one local entry point. Keep all samples and captures; never substitute historical fastest rows or skip a slow scene.
2. Establish same-revision A/A on the Mini, reporting CPU p50/p95 by scene and backend. Separate previously known native image differences from new same-route differences.
3. Verify doctor, actual Wasm build, both complete passes, report and required repository checks. Keep costly GPU timing local; deliver via the current-head required PR check.

## Local performance change policy

The [v1 manifest](../../benchmarks/browser-baseline-v1.json) is the contract. Use native Chrome WebGL, Chrome Refral JS and Chrome Refral Rust with actual Wasm in every cell. Use pinned fixture sources and deterministic poses. Animometer original 20K and scaled attributes 256 stress different input APIs; Aquarium 500 and 20K protect small and large textured scenes; Dynamic Cube Map exercises multipass rendering; Suzanne 3000, Cubes 2000 and Shapes four protect high, partial or absent gains from reuse. Do not add the Animometer uniform sweep to the score: that is an attribution experiment. Original attributes 20K startup failures stay tracked separately in [task 131](131-external-webgl-benchmarks.md). Version workload or protocol changes explicitly and rebaseline.

With the pinned compiler built and external sources acquired (`pnpm bench:external:deps`), run `pnpm rust:build` for the revision and `pnpm bench:baseline`. The latter takes the shared lock, pins headless Chrome and one worker, verifies the Suzanne fixture, and runs both harnesses sequentially. Do not run other CPU/GPU jobs while sampling. Each command prints a fresh directory under `artifacts/browser-baseline-v1/`; both subdirectories contain raw frames, screenshots and environment/build identities. A failed/partial run is not a baseline. CPU ms/frame includes scene logic, API preparation and dispatch through `gl.flush()`; excludes startup, GPU completion, image capture and rAF pacing. Cold/failed startup, GPU time, memory and FPS are not represented by this metric.

1. On a new measurement machine, browser version or fixture version, collect two full passes at the same clean rendering revision. With their output paths as `A1` and `A2`, run `node tools/browser-baseline-report.mjs "$A2" "$A1"`. Inspect images and `comparison.json`. This is an empirical noise estimate, not a confidence interval.
2. For a performance change, alternate main and candidate measurements under the same exclusive conditions; build the matching real Wasm each time. Compare the candidate to its **same-route** contemporaneous control: `node tools/browser-baseline-report.mjs "$CANDIDATE" "$CONTROL" "$A2/comparison.json"`. Native Chrome is a drift sentinel, never a substitute for the before-build. Treat native drift as a reason to repeat the experiment, not as an optimization. Keep A/A and candidate output directories distinct.
3. Report nearest-rank pooled p50/p95 (360 frames per cell), paired per-round values and absolute deltas. Flag a slowdown if the pooled delta exceeds that cell/metric's largest absolute A/A delta (pooled or per round) and at least two of three round deltas are positive. Retest flagged cells interleaved and inspect small persistent trends too. Never trade a confirmed unexplained per-cell regression for an improved average. This is a local performance review gate, not required Actions CI.
4. Require equal work (external audit draws, or Three per-frame pose and primitive counts), hardware adapters and no GL/route errors. Inspect every changed same-route capture against its reference, even when native tolerance passes. The native limit remains <0.2% of pixels over RGB delta 2. Retain the known Aquarium exception as a **visual failure against native** ([task 134](134-webkit-aquarium-mips.md)), not a relaxed tolerance: both cores must agree and candidates must not silently change the reference image. For paging or cache changes, additionally rerun dense peak and 16-frame sparse-retention probes from [task 130](130-draw-snapshot-reuse.md). Node references are never pooled with browser cells.

## Initial Mini reference, 2026-11-28

Main rendering revision `38fbc45`; the only timing-harness changes in the measurement tree select isolated output directories. Actual release Rust Wasm SHA-256 `d46b04fc95ff3018735e6b4b476cf68b8d8c1064e6e04bb892fa62804c884a3f`, compiler Wasm `d62226acfc67938a6d5cec1e5ee0e9c56d99636e2151ba097eafc73a03bf2a14`. Mac mini Apple M6, macOS 27.2.1, Chrome 158.0.8127.37, Node 24.14.0, native ANGLE Metal and hardware Apple WebGPU. Raw evidence: `artifacts/browser-baseline-v1/20261128T110637.198793Z` (A1), `artifacts/browser-baseline-v1/20261128T110819.009252Z` (A2). A1 values, CPU p50 / p95 ms/frame; A2 is a repeat, not a candidate or a source of cherry-picked replacement cells.

| Scene | Chrome WebGL | Chrome Refral JS | Chrome Refral Rust/Wasm |
| --- | ---: | ---: | ---: |
| Animometer original | 2.960 / 3.645 | 29.685 / 30.820 | 28.520 / 29.525 |
| Animometer attributes 256 | 0.055 / 0.075 | 5.530 / 5.930 | 5.670 / 6.040 |
| Aquarium 500 | 1.355 / 1.550 | 5.230 / 5.665 | 4.970 / 5.555 |
| Aquarium 20,000 | 3.760 / 3.970 | 71.245 / 73.030 | 58.270 / 59.685 |
| Dynamic Cube Map | 0.575 / 0.705 | 3.280 / 4.420 | 4.465 / 5.135 |
| Suzanne 3000 | 2.435 / 3.285 | 5.305 / 5.625 | 5.160 / 5.620 |
| Cubes 2000 | 4.440 / 6.030 | 5.205 / 5.640 | 5.200 / 5.615 |
| Shapes four | 0.715 / 1.180 | 1.950 / 2.355 | 1.985 / 2.230 |

Dynamic Cube Map A1 has two exact captures on each polyfill route. They differ by one of 480,000 pixels (maximum RGB delta 7). The comparator records a known same-route alternate only if its full decoded capture matches one of the reference's three rounds for that cell; it requires review for any unseen hash. This does not extend a tolerance to other changes. Aquarium's two native mismatches persist at 9,098 and 7,760 pixels over delta 2, respectively, while both Refral cores agree. Shapes has 1,177 such pixels out of 1,920,000, within its native tolerance.

A2 also exposed a native-only Aquarium 20K one-level difference at pixel (265,325), with no alpha change. The [reviewed exact pairs](../../benchmarks/browser-baseline-v1-images.json) supplement reference-round matching only for these named cells, browser, CPU and OS. No general pixel tolerance was changed. Both full passes produced 144 runs and 17,280 timed frames total. Per-cell noise is in A2 `comparison.json`; e.g. JS Shapes p50/p95 observed noise is 0.090/0.100 ms, versus 0.585/0.515 for JS Cube Map. Native Suzanne p95 varied by up to 1.635 ms across paired rounds; do not infer a small tail improvement from a single run. Longer-term noise still needs repeated controls.

Doctor, the actual release Wasm rebuild, both single-worker headless campaigns, `pnpm check` (248 unit, 79 tooling, 77 native Rust tests) and `pnpm ci:check` passed. No changes to renderers, ANGLE or required CI. Delivery: task 139 branch `p/luchengxuan/browser-perf-baseline`.

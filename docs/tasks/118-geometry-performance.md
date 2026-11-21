# Geometry performance on Marching Cubes

Improve shared vertex materialization, retain reusable vertex/index GPU Buffers, then remove full geometry payloads from Rust draw replies. Compare each intermediate version to its immediate predecessor on the continuous Marching Cubes workload. Repeat the static Shapes workload to verify cache reuse. Base on 31bd898 and the packed-float experiment in `artifacts/performance-analysis`.

1. BrowserHost owns the packed FLOAT path. Keep the generic path for formats, missing components, indexing and stride that need transformation. Check matching component count, valid size and offset, byte order and exact covered range before using source bytes. Cover the path through both real cores and the native image comparison.
2. BrowserHost owns persistent geometry resources. Both cores supply immutable Buffer version identities. Keep reuse bounded and retire evicted resources only after submitted work has completed. Transient draw resources keep their existing submission lifetime. Verify repeated static draws, mutation, buffer replacement, index type/layout, retained VAO references and context teardown.
3. Rust core and Wasm transport own draw Buffer metadata and a checked lookup for the corresponding linear-memory bytes. The adapter owns any byte snapshot it hands to BrowserHost and reuses it for repeated references. Preserve public inspection copies, raw index/range validation, error behavior and context isolation. Bump the private ABI and verify build/deployment consumers. Record the remaining copy costs.

The primary comparison uses one actual Chrome GPU worker with headless Chrome, isolated browser profiles, fixed 800 × 600 rendering, 30 warmups, 120 samples and three rounds. Rotate order across builds and backends. Keep the draw workload and final pixels identical. Report CPU render + flush p50/p95, full frame CPU p50/p95 including geometry generation, geometry/total upload bytes, Buffer allocations and Rust draw reply payload. Save raw samples and images under `artifacts/geometry-performance`. Separately check cache performance on Shapes, where geometry stays unchanged. Record diagnostic probes independently of committed variants.

Run `pnpm check`, `pnpm rust:build`, `pnpm rust:test:wasm`, focused Chrome differential/CTS/Three.js coverage and the built deployment checks. Record source and Wasm identity per stage. See [vertex-input rules](../adr/011-vertex-input-and-topology.md) and the [Buffer contract](../core-api.md).

## Smoke results

Packed FLOAT lowered steady render and flush CPU p50 from 3.22 to 0.88 ms on JS and 3.23 to 1.40 ms on Rust in the 15-warmup/45-sample paired Marching Cubes run. Workload, uploaded bytes and final pixels matched.

The persistent cache smoke retained zero repeat geometry uploads in Shapes (from 599,228 bytes/frame on JS and 614,935 bytes/frame on Rust). Marching Cubes still uploaded three new attribute versions per frame. The paired draw workloads and pixels matched in both demos. The host bounds retention to 512 entries and 8 MiB per context and sends evictions through completion-aware retirement.

The Rust bridge smoke changed render and flush CPU p50 from 1.78 to 1.18 ms. A separate one-frame witness measured one binary draw reply at 3,539,820 bytes before the change and 876 bytes after. ABI7/RFD8 retains a checked Rust lookup and one owned JS snapshot on a new Buffer reference. The three changing attributes still require 3,538,944 bytes of owned snapshots per frame in this workload. Those bytes no longer pass through the reply arena.

## Marching Cubes results

Headless Chrome 158.0.8127.36 on an Apple M4 Max Metal hardware adapter. All stages used the same 800 × 600 scene, pose sequence and ANGLE module. Three rounds rotated the four stages and two cores. Each stage/backend/round had 30 warmup frames and 120 samples. Host method timings were sampled on 14 of the 120 frames and those frames were excluded from CPU percentiles. The observed timer increment was 0.005 ms. Each value is the median of three per-round percentiles, in ms per frame. Geometry generation and asynchronous GPU completion are outside render and flush time. Full CPU time includes geometry generation. The benchmark used Vite's dedicated test server and an isolated Playwright context per run.

| Stage | JS render p50 / p95 | Rust render p50 / p95 | JS full CPU p50 / p95 | Rust full CPU p50 / p95 |
| --- | ---: | ---: | ---: | ---: |
| Base 31bd898 | 2.960 / 3.520 | 3.620 / 4.105 | 5.335 / 6.185 | 6.070 / 6.765 |
| Packed FLOAT 6a949ca | 0.940 / 1.205 | 1.625 / 1.925 | 3.705 / 4.085 | 4.155 / 4.915 |
| Geometry cache bd0f725 | 1.010 / 1.235 | 1.695 / 2.090 | 3.295 / 4.050 | 4.235 / 5.055 |
| Rust draw references | 1.060 / 1.565 | 1.470 / 1.740 | 3.630 / 4.970 | 4.390 / 4.835 |

All 24 runs used the same workload and produced the same final pixels. Each stage uploaded 1,346,292 geometry bytes per frame in three geometry buffers, with two default canvas submissions. Packed FLOAT lowered render p50 by 68% on JS and 55% on Rust. The persistent cache cuts static Shapes uploads, while Marching Cubes creates new geometry versions each frame and recorded a 0.07 ms increase on both cores. Rust draw references lowered Rust render p50 by 13% against the cache stage and improved its p95. JS timing varied across stages with the same JS runtime, and time spent generating the mesh varied across rounds. The CPU values do not measure GPU execution.

Raw timings, launch configuration, stage revisions and hashes, the final stage patch and 24 images are under `artifacts/geometry-performance/2026-11-21T11-43-20.477Z/`. The Rust reply witness is under `artifacts/geometry-performance/2026-11-21T11-43-16.009Z/`. The archived ABI6 and ABI7 binaries, run script and server entry are under `artifacts/geometry-performance/`.

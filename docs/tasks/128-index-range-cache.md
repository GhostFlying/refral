# Reuse indexed draw extents

Start from main `5dbd83c`. [Task 127](127-large-three-scenes.md) isolated repeated validation of static Suzanne indices in both semantic cores. Reuse one decoded extent per element buffer for a given byte interval and element width until its contents change. Keep all type, offset, count, buffer bounds, vertex attribute and program checks at their existing positions. Retained buffer identity and snapshot ownership follow ADRs 004, 005 and 011 and the pinned [vertex-range rules](../spec-map.md#webgl1-interface-and-vertex-input).

Own the JS buffer resource and draw implementation, Rust semantic buffer and draw implementation, a shared public draw regression, and this record. Exercise repeated draws, offset/count/type changes, subdata and storage replacement, vertex storage shrink, rejected writes, zero count and buffer identity. Run deterministic checks, release Wasm tests, headless Chrome, relevant original CTS and packaged deployment. Compare native, parent and release candidate on the same hardware in rotating order with 30 warmup and 120 measured frames per round. Use both Suzanne sizes and the short-index Cubes and Shapes controls. Check raw work, host counters, images, p50 and p95 per round before delivery.

## Implementation

Each semantic buffer owns at most one cached index interval. The interval stores the byte start, byte end, unsigned element width and the required vertex count (maximum index plus one). JS matches the current content version, which advances on writes and reallocation. Rust drops the entry in the common storage replacement path used by bufferData and bufferSubData. The stored result holds scalar metadata and cannot extend the lifetime of any upload data. Object deletion, VAO retention, GPU draw snapshots and public ABI follow the existing lifetime rules.

Draws still validate the element binding, type, alignment and byte bounds. Active attribute sizes and strides are checked against the current vertex buffers on every draw, including cache hits. Zero-count draws and the existing unsigned-int path with no enabled shader inputs retain their previous behavior.

## Performance

Three interleaved rounds compared native WebGL with both cores at the parent and release candidate, using a fresh page per variant and 30 warmup plus 120 measured frames per page. The sample covers scene animation and Three.js rendering through the return from `gl.flush()`. Screenshots and GPU completion are outside the CPU interval. Each table cell is the median of the three round-level p50 / p95 CPU times, in milliseconds per frame.

| Workload | Native | JS before | JS after | Rust before | Rust after |
| --- | ---: | ---: | ---: | ---: | ---: |
| suzanne-1000 | 1.945 / 2.540 | 6.970 / 7.685 | 3.620 / 4.980 | 5.090 / 5.705 | 4.440 / 4.940 |
| suzanne-3000 | 3.220 / 5.290 | 20.850 / 22.685 | 9.845 / 11.255 | 13.255 / 14.790 | 10.685 / 11.725 |
| interactive-cubes | 2.880 / 6.095 | 9.620 / 10.510 | 9.845 / 11.265 | 9.005 / 9.770 | 9.230 / 9.860 |
| shapes-four | 1.555 / 2.425 | 2.500 / 3.020 | 3.070 / 3.815 | 2.675 / 3.795 | 3.080 / 3.575 |

Headless Chrome 158.0.8127.88 used the Apple M4 Max. Native used ANGLE/Metal. Both Refral routes reported the non-fallback Apple metal-3 adapter. Timer resolution was approximately 0.005 ms. All 60 page runs matched the native draw and primitive sequences and passed the native pixel tolerance. Release and parent images were byte-identical for every route, scene and round, with identical host counters and Rust command transport counts. The Wasm SHA-256 values are `3fa95aba2510c8ba07ca2f1858588fd33278b387437deabff666c3996cd524c1` (parent) and `ec6f255d60d84480fe514cc269907fefad59f82c82db2bd65fd7aae2b5a12ef5` (release).

Raw frame samples, execution environment and captures are in `artifacts/index-range-cache/2026-11-26T12-20-23.885Z/`. The interleaved driver is `artifacts/index-range-cache/compare.mjs`. A single-build rerun uses `pnpm bench:three:large`.

With 3,000 Suzanne meshes the observed p50 gains in the three paired rounds were 12.135, 10.510 and 10.995 ms for JS and 1.625, 2.615 and 2.530 ms for Rust. Both p50 and p95 also fell in all three rounds with 1,000 meshes. Interactive Cubes produced mixed round-level deltas.

## Paired control for the smaller index ranges

Independent-page Shapes JS p50 rose in all three rounds. A separate diagnostic build switched between the release and parent range-validation code on the same context, device, page and scene. Each pose was drawn once per algorithm. An ABBA sequence reversed by round distributed order effects. The switch was outside CPU timing. Each of four rounds warmed up 40 poses and measured 120 poses per algorithm. The two arms matched per-pose draw and primitive counts, and all three routes passed image and error checks.

| Scene | Core | Scan p50 / p95 | Cache p50 / p95 | Paired p50 savings per round (ms) |
| --- | --- | ---: | ---: | ---: |
| shapes-four | js | 2.803 / 3.943 | 2.760 / 3.980 | +0.025 / +0.010 / +0.045 / +0.075 |
| shapes-four | rust | 3.295 / 4.358 | 3.360 / 4.142 | -0.010 / -0.105 / +0.020 / -0.050 |
| interactive-cubes | js | 9.827 / 10.777 | 9.635 / 10.352 | +0.235 / +0.025 / +0.315 / -0.060 |
| interactive-cubes | rust | 9.105 / 10.257 | 9.097 / 10.330 | +0.015 / -0.115 / +0.005 / -0.090 |

Raw paired frames and captures are in `artifacts/index-range-cache/2026-11-26T12-26-18.262Z/`. The diagnostic switch exists only in the archived verification build.

An independent four-round Shapes-only repeat used the parent and release binaries from the primary benchmark. Identical work, images and host counters were checked again. Samples are in `artifacts/index-range-cache/2026-11-26T12-28-38.557Z/`.

| Route | Native p50 / p95 | Before p50 / p95 | After p50 / p95 | Paired p50 savings, rounds 1–4 (ms) |
| --- | ---: | ---: | ---: | ---: |
| js | 1.135 / 2.713 | 2.775 / 3.340 | 2.455 / 3.077 | +0.830 / +0.065 / +0.020 / +0.440 |
| rust | 1.135 / 2.713 | 2.250 / 2.615 | 2.225 / 2.565 | +0.010 / -0.005 / +0.145 / +0.055 |

The Shapes slowdown in the primary run did not repeat at the same magnitude in the paired control or in the independent release-build repeat. Its exact cause remains unresolved. The short-index scenes have no repeatable large gain. Accept the cache for the reproducible improvements to both percentiles on both Suzanne sizes, with the small-scene measurements retained above.

## Regression evidence

The new shared draw fixture passed all 24 observable checks on native, JS and release Rust/Wasm and matched the expected pixels. It covers the same byte interval at different index widths, offset and count changes, another buffer with the same version, increasing and restoring the maximum by subdata, storage replacement, rejected writes, zero count and vertex storage shrink after a cache hit. Captures and GL results are under `artifacts/dual-core-drawing/indexed-range-validation/`.

`pnpm check`, `pnpm ci:check` and the 59 actual-Wasm tests passed. The complete headless Chrome suite passed 226/226 and `pnpm test:dist` verified the packaged compiler, release core and GPU outputs. The selected original buffer, vertex attribute, VAO, uint-index and out-of-bounds draw CTS files passed 34/34 on each route. Native ran 7,644 passing assertions and each Refral core ran 5,308. The six attribute files accounting for the difference had the same counters as in the prior report. The 33 overlapping files retained their per-route status and assertion counts, and the additional uint-index file passed 89 assertions on each route. Original file identities, counts and screenshots are in `artifacts/index-range-cache/cts/`. See `artifacts/index-range-cache/verify.sh` for the exact filter and commands.

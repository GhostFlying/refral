# Retain Rust Buffer versions between draws and frames

Compare against main at d549c5c, including the experimental Rust command buffer. Remove repeated Wasm-to-JS copies when Rust observes the same Buffer version in nonadjacent draws or successive frames. Measure the shipped code in headless Chrome against the same native WebGL and JS workloads.

- The Rust adapter owns the per-context cache. Use slot, object generation, storage generation, content version and byte length from the validated draw record. Copy the Wasm range on a miss and retain only the latest observed version per cached slot.
- Bound retained bytes and entries. Keep the existing consecutive-draw reuse for data that exceeds the shared cache budget. Deletion, context loss and disposal release cache ownership. Earlier draws retain their own immutable bytes.
- Add actual-Wasm assertions for consecutive and interleaved versions, upload mutation, deletion and replacement. Exercise both the default and batched Rust paths in Chrome, including same-task updates and image output.
- Run pnpm check, pnpm rust:test:wasm, headless Chrome, and the built deployment checks. Compare Four-view Shapes and a low-draw control with exact same-core pixels, native reference, repeated CPU p50/p95 and host and Buffer-copy counters. Save run artifacts under artifacts/native-gap/.

The follow-on shared pass-state change has independent acceptance. Canvas presentation investigation retains the existing canvas and readback behavior.

## Implementation

The per-context cache keeps the most recently observed version for each cached slot. Cache hits compare generations and content version before reusing an owned copy. Mismatch replaces the prior entry. Capacity eviction uses insertion order so hits only read the cache. The retained tier holds up to 512 entries and 32 MiB. Individual snapshots larger than 32 MiB retain the prior consecutive-draw reuse and are excluded from the retained tier. Deletion clears the matching generation, and loss and disposal clear the context cache. Per-call and batched Rust share this resolver.

## Repeated CPU comparison

The control is d549c5c. The archived implementation used the same compiler and Rust module with SHA-256 62cc4f7394d3567252eefac6aa149ee5b26fa7f92f30c23f53fd0cec986b44a9. Runs used headless Chrome 158.0.8127.88, Apple M4 Max Metal and an exclusive GPU slot. Each of three rounds used 30 warmup frames and 120 measured rAF callbacks and rotated backend order. The table shows median-of-rounds CPU p50 / p95 in milliseconds per frame. CPU includes animation, GL calls, recording, encoding and flush. GPU completion and screenshots run outside the timed interval.

| Scene | Native WebGL | JS | Batched Rust before | Batched Rust with cache |
| --- | ---: | ---: | ---: | ---: |
| Four-view Shapes | 0.535 / 0.660 | 4.255 / 4.940 | 2.720 / 3.290 | 2.470 / 3.370 |
| Triangle cloud | 0.145 / 0.195 | 0.375 / 0.455 | 0.435 / 0.535 | 0.420 / 0.510 |
| Sobel 1080p | 0.150 / 0.270 | 0.540 / 0.940 | 0.630 / 0.740 | 0.585 / 1.240 |

Shapes issued 369 draws per frame. The cache eliminated 129 steady-state copies and 599,228 copied bytes per frame after warmup. GPU uploads stayed at approximately 189,070 bytes per frame, with two passes and one submission. Batched Rust p50 improved in all three Shapes rounds, and its p95 improved in two of three. Its median-of-rounds p95 rose by 0.080 ms. Sobel eliminated five copies and 301,908 copied bytes per frame and its p95 varied. Triangle cloud already performed zero steady copies. The final captured pixels matched same-core controls exactly across all 54 runs including the shared-pass experiment. The maximum fraction of pixels differing from native by over two bytes in any RGB channel was 0.062%.

In a separate matched three-round Shapes comparison of the **default per-call Rust path**, p50 / p95 improved from 6.655 / 7.610 to 6.020 / 6.745 ms per frame. Both percentiles improved in every round. The earlier command-buffer option remains an explicit benchmark control. Use `REFRAL_HEAVY_RUST_BATCH=1 pnpm bench:three:heavy` to exercise that path.

Raw archives, per-frame samples, final screenshots and environment metadata are in `artifacts/native-gap/2026-11-26T08-06-30.388Z/` and `artifacts/native-gap/2026-11-26T08-09-12.471Z/`. [Task 124](124-webgpu-pass-state.md) records the independent shared-host experiments.

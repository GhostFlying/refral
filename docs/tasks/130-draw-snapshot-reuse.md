# Draw snapshot allocation and batched reply reuse

Base: e2c7a28. Keep the public WebGL contract, the per-draw state and resource versions, and both cores' validation unchanged. See the shared core contract and ADRs 005, 006 and 014. The original feasibility measurements are in artifacts/draw-snapshot-study/report.md.

1. JS core: store each owned uniform snapshot in a never-overwritten part of a bounded page. Check queued snapshots across draws, page rollover, large blocks and release. Measure retained backing storage for sparse and dense consumers and observe memory on animated scenes.
2. Rust raster: use a negotiated batch entry point to reference the preceding draw's identical raster bytes in this drain. Preserve the legacy batch and individual draw protocols and reject invalid references. Check changes to viewport, masks, depth and blend, including the first draw after a drain.
3. Rust geometry: independently reference matching vertex/index descriptors including versions, offsets, formats and constants. Keep complete descriptors on misses. Check buffer updates, VAO switches and lifetime of buffered data.
4. Integrate the three atomic changes in order. Use pnpm check, pnpm ci:check, pnpm rust:build, pnpm rust:test:wasm, headless Chrome, dist and affected original CTS. Measure native, the parent and each affected production revision on the same hardware in alternating order. Report raw samples, CPU ms/frame p50/p95 and the zero-geometry-hit Shapes workload.

The integrating owner maintains runtime code, protocol documentation and final results. The performance runner and verification fixtures have separate owners. All hardware runs use the exclusive GPU lock and headless Chrome.

## Mini continuation

- Start from `e9766b0` (JS uniform pages) then `8073b48` (Rust raster references); the integration baseline is `e2c7a28`. The mini checkout is the write owner for the remainder of this task.
- Own the Rust draw and batch encoders, the TypeScript adapter and batch replay, actual-Wasm transport tests, and protocol/result documentation. The shared core API, compiler and browser host stay unchanged.
- Preserve [vertex input and buffer rules](../spec-map.md#webgl1-interface-and-vertex-input): rejected calls do not change the earlier state, and each successful draw sees the validated vertex/index format, offsets and buffer versions at that call. Compare complete encoded descriptors and constant bits only after the core has validated the draw. The flags must not affect validation, errors, resource order, counts, uniforms or the target.
- Verify first and subsequent draws, drain boundaries, reentrant callbacks, descriptor misses, oversized backing ownership and both directions of transport compatibility with `pnpm rust:build` and `pnpm rust:test:wasm`. Then run the integration checks in step 4. Keep mini and laptop results separate under `artifacts/draw-snapshot-release/`.

## Mini verification

The production changes on [PR #114](https://github.com/GhostFlying/refral/pull/114) are JS paging `e9766b0`, Rust raster `8073b48`, and Rust geometry `b78cb82`, in that order above `e2c7a28`. The wire change is documented in the [Rust transport](../../packages/core-wasm/README.md#compact-batch-replies). The WebGL profile and shared host are unchanged.

- `pnpm check` passed: 248 unit, 76 tools, and 77 native Rust tests, plus TypeScript, Rust formatting/Clippy and support metadata. `pnpm ci:check` passed.
- `pnpm rust:build` and `pnpm rust:test:wasm`: 70/70 with the final real Wasm. The baseline module with the final adapter passed 63 with 7 compact-only skips. The raster-only module with the final adapter passed 70/70, and the final module with the raster-only adapter passed 63/63. The suite also forces legacy-batch and direct paths on the final module.
- `REFRAL_HEADLESS=1 pnpm test:chrome --workers=1`: 232/232. The initial run started before the fixture manifest, demo adapter and experiment Wasm were ready; the clean full rerun passed after `node tools/deps-fixtures.mjs` and `pnpm core:build`. See `mini-verification/chrome-complete-results.json` under the release artifact directory.
- `pnpm build` and `pnpm test:dist` passed the headless probe, three-path pixels, synchronous readback, DOM and CubeMap verification, and packaged Wasm hashes.
- The unchanged adjacent-draw selector in `artifacts/adjacent-draw/verify.sh` ran the 71 pinned Khronos originals on each backend, all passing. Original identities, outcomes and assertion counts match the transferred laptop control per backend: native 9,535, JS 7,192, Rust 7,192. Mini Chrome is 158.0.8127.37; the old control used 158.0.8127.88. Evidence, including screenshots, is under `artifacts/draw-snapshot-release/mini-verification/cts/`.

The mini uses macOS 27.2.1 (26B131), Node 24.14.0, pnpm 10.12.3, Rust 1.94.1 with `wasm32-unknown-unknown` and the transferred pinned ANGLE build. The final Rust Wasm SHA-256 is `52c5af557e5603784300e62a47a463c398702e7a7cc4d6c444744149dc3ff3e1`. Doctor, dependency, build, compatibility and browser logs are under `artifacts/draw-snapshot-release/mini-verification/`; the workspace-only environment is loaded with `source artifacts/draw-snapshot-release/handoff/mini-env.sh`.

## Mini CPU measurements

Mac mini Mac18,5 (Apple M6), isolated headless Chrome 158.0.8127.37, native ANGLE Metal and WebGPU `apple/metal-3` (not fallback). An exclusive GPU lock covered the serial routes. Each route and scene ran three rotated-order rounds with 30 warmup and 120 measured frames per round. The table shows pooled nearest-rank p50 / p95 in **CPU ms/frame** (360 samples per cell; timer resolution about 0.005 ms). The timed interval is Three.js scene rendering and `gl.flush()`: this includes draw and upload input preparation, CPU copies/transport, validation, and host encoding/submission, but neither GPU completion nor the screenshot. Startup, initial uploads and warmup are outside the interval. No additional geometry buffer bytes were copied by Rust in the measured frames.

| Route | Suzanne 3000 | Cubes 2000 | Shapes four |
| --- | ---: | ---: | ---: |
| Native | 4.97 / 6.35 | 5.28 / 6.12 | 1.97 / 2.26 |
| JS baseline | 5.46 / 5.72 | 5.57 / 5.95 | 3.96 / 4.86 |
| Rust baseline | 5.46 / 5.85 | 5.53 / 5.92 | 3.85 / 4.64 |
| JS pages | 5.42 / 5.68 | 5.27 / 5.80 | 3.85 / 4.80 |
| Rust raster | 5.32 / 5.83 | 5.33 / 5.78 | 3.87 / 4.64 |
| Rust raster + geometry | 5.22 / 5.70 | 5.33 / 5.81 | 3.80 / 4.59 |

The 54 runs used archived sources and matching real Wasm builds. Per-frame poses and submitted geometry counts matched: Suzanne averaged about 2,600 draws after culling, Cubes drew 2,000, and Shapes averaged 369. The measured Refral host work matched across revisions: one submission, two passes and about 1,329,670 / 1,023,424 / 189,070 uploaded bytes per frame, respectively. Refral screenshots were byte-exact across cores and revisions; at most 0.0614% of pixels exceeded RGB delta 2 versus native (limit 0.2%).

Geometry saved about 539,906 / 415,168 / 0 reply bytes per frame versus raster-only for Suzanne / Cubes / Shapes. Suzanne improves CPU p50 and p95; the additional savings for Cubes are in reply bytes rather than measured CPU time. In Shapes the three round-by-round geometry-minus-raster deltas were −0.315, +0.025, +0.025 ms at p50 and −0.395, +0.220, +0.020 ms at p95. The mixed direction gives no consistent end-to-end penalty or gain for the zero-hit path; the pooled improvement is not an isolated estimate of descriptor comparison cost. A separate, untimed audit of the real Shapes replies confirmed 0 geometry and 42,673 raster references across 56,120 draws including warmup and screenshot poses (`mini-verification/shapes-reference-audit.json`).

Mini raw frames, images, runtime configuration and hashes are in `artifacts/draw-snapshot-release/2026-11-28T07-23-19.170Z/`. After preparing the stage builds, reproduce from the repository root with `python3 artifacts/geometry-performance/lock.py bash artifacts/draw-snapshot-release/handoff/measure-mini.sh`; see `mini-verification/performance-summary.txt` under the release artifact directory for individual round summaries. The earlier laptop experiments remain separate in `artifacts/draw-snapshot-study/report.md`; those measurements are not pooled with mini samples.

## Mini JS memory

The separate memory run samples CDP `Runtime.getHeapUsage` backing storage for the whole renderer isolate every five frames, with explicit GC outside sampling before and after the 120 measured frames. These are sampled peaks, not process or GPU memory. Values are ranges across three runs. A separate BrowserHost interception retains and verifies the actual uniform byte views from one full frame (dense) or the first draw of each of 16 successive frames (sparse). The retained bytes below count each backing buffer once.

| Scene | Sampled peak MiB, baseline → pages | Dense backing B, baseline → pages | Sparse backing B, baseline → pages |
| --- | ---: | ---: | ---: |
| Suzanne 3000 | 20.81–20.82 → 16.05–20.93 | 494,784 → 589,824 | 3,072 → 1,048,576 |
| Cubes 2000 | 14.32–15.48 → 15.53–16.59 | 544,000 → 589,824 | 4,352 → 1,048,576 |
| Shapes four | 11.13–11.14 → 11.28–11.31 | 80,352 → 131,072 | 5,888 → 1,048,576 |

Cubes' 4,000 uniform views use nine pages instead of 4,000 backings in the dense frame, with identical payload and intact views. Sparse consumers can pin 16 pages; the current BrowserHost consumes synchronously, but the ownership contract also allows retaining a draw. Post-GC backing storage was about 68 KiB higher on the paging build in each scene; sampled peaks did not consistently fall. This is a measured memory trade-off, not a general memory reduction. The mini evidence is `artifacts/draw-snapshot-release/memory-2026-11-28T07-25-57.431Z/memory.json`; the earlier transferred memory progress is not part of these results.

The PR records the exact required-check and merge state. The mini handoff `artifacts/draw-snapshot-release/handoff/mini-delivery.md` records the PR head and the verified main revision after rebase.

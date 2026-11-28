# 135 Aquarium CPU profile

Investigate the JS/Rust frame CPU gap in the pinned Aquarium benchmark from task 131 on the same Mini. Use that task's uninstrumented timings as the performance baseline. Task 134 records the deferred image difference.

Use serial headless Chrome under the shared GPU lock. Collect renderer main-thread CPU samples for real JS and Wasm runs of 20,000 fish. Compare the hottest stacks, inspect their call sites and distinguish common host costs from core-specific work. Validate draw counts, hardware adapter and errors with the task 131 runner. Own this task record and ignored profiling artifacts.

The initial profile identifies repeated execution-resource image lookups. Limit the implementation to removing redundant image-key construction in the shared registry. Preserve validation of handles, image identities and both version numbers. Compare three unprofiled Rust rounds before and after under the same lock, audit the images and rerun resource and browser tests.

## Attribution and change

On Apple M6, macOS kernel 27.2.0 and headless Chrome 158.0.8127.37, the Rust adapter decodes each sampled mip image version and asks the execution registry for the corresponding storage. The registry validated the handle, built the full image key to find its record, then built the keys for both versions again to compare their identities. The map lookup already selected the context, slot, object generation, face and level. The lookup now builds that key once and compares the storage generation and content version directly. The Rust binary and wire format are identical on both sides of the measurement.

A renderer DevTools CPU profile of the 20,000-fish Rust workload attributed 55.7% of the sampled time to leaf frames in the shared execution registry (4.69 s of 8.43 s). The Rust adapter's texture-binding decoder including callees accounted for 5.27 s. The JS run had no leaf samples in that registry. Native WebGPU calls to create texture views and bind groups took 0.66 s in JS and 0.72 s in Rust in these profiles. The registry's share in a subsequent Rust profile fell to 34.3%. These are shares of the profiler session, including warmup, waits and the audit, with a requested 500 µs sampling interval. Compare uninstrumented frame timings below for the actual speedup.

A short controlled repeat on the parent and modified code used three rounds of 12 warmup and 30 sampled frames per round. At 20,000 fish, pooled Rust CPU p50/p95 fell from 456.485/463.295 to 281.840/290.000 ms/frame. All six audit images have identical PNG hashes, with 20,110 draws per audit. Each measured round submitted 30 times, issued 603,300 draws and uploaded 309,335,520 bytes.

## Full Aquarium measurements

Pooled nearest-rank CPU p50 / p95, ms per frame, 360 samples per cell. The first three columns of timings use task 131 on the same Mini. The last column uses three fresh Rust runs, each with 30 warmup frames and 120 measured frames. The driver and application work counted in these measurements is described below.

| Fish | Native | JS | Rust before | Rust after |
| ---: | ---: | ---: | ---: | ---: |
| 500 | 1.245 / 1.465 | 4.995 / 5.325 | 13.440 / 14.130 | 9.020 / 9.635 |
| 20,000 | 3.555 / 3.965 | 166.665 / 170.790 | 459.295 / 463.040 | 284.840 / 290.055 |

All six revised runs passed on the Apple hardware adapter with zero captured errors. Audit draw counts were 610 and 20,110 per frame respectively. Every final Rust audit PNG matched the task 131 Rust capture at the same fish count byte for byte. The task 134 deferred comparison to native still applies.

## Reproduction

From the Mini checkout with its pinned environment, run the following command on each revision. Use the prebuilt compiler and core Wasm with hashes recorded in each environment file. The task 131 harness times the application's simulation, WebGL calls and flush through CPU-side submission. It excludes the final completion wait, audit and screenshot. GPU duration was unmeasured.

```sh
source artifacts/draw-snapshot-release/handoff/mini-env.sh
REFRAL_TEST=1 REFRAL_BENCHMARK=1 REFRAL_CASES=aquarium,aquarium-20k \
  REFRAL_BACKENDS=rust REFRAL_ROUNDS=3 REFRAL_WARMUP=30 REFRAL_SAMPLES=120 \
  python3 artifacts/geometry-performance/lock.py node tools/external-benchmarks.mjs
```

The short before/after raw runs are in `artifacts/external-benchmarks/2026-11-28T08-58-46.514Z` and `2026-11-28T08-59-54.687Z`. The full comparison uses `2026-11-28T07-52-05.321Z` and `2026-11-28T09-00-33.070Z` in that directory. The Mini's `artifacts/aquarium-performance/profile.mjs` adds CDP profiling around the runner's evaluation. Use the same command with that entry point, 8 warmup frames, 20 samples and one round. The raw profiles are in its sibling directories ending in `08-57-55.767Z` and `09-00-26.050Z`. The aggregation script is `artifacts/aquarium-performance/results.py`.

## Remaining cost

With the change applied, the Rust adapter's texture-binding decoder including callees still accounts for 44.6% of the 20K profile. A bounded follow-up can measure how often adjacent draws bind the same sampler parameters and versions of every sampled face and level. That hit rate would quantify the opportunity to reuse complete bindings across adjacent draws. Shared-host view and bind-group creation is a separate cost on both cores.

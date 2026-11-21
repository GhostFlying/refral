# Batched uniform storage and Rust dispatch

Compare two independent performance changes against main 42fed49 in four-view Shapes (many small draws) and the triangle cloud (a few large draws). Use the shared browser host and native WebGL in the same headless Chrome campaign. The host change owns `packages/browser-host` and focused browser fixtures. The transport change owns `packages/core-wasm` and, if a new export is needed, `crates/wasm` and the artifact verification entry points. Keep public WebGL calls, draw snapshot semantics, and default canvas submission boundaries.

1. Profile the current Rust and JS paths on four-view Shapes using separate Chrome DevTools Protocol CPU captures. Read the profiles before selecting exact Rust calls to optimize. Preserve semantic validation in Rust and compare against the existing binary draw snapshot and resource operations.
2. Allocate aligned per-draw vertex and fragment uniform ranges in a shared host staging buffer. Bind each program to the relevant page with explicit sizes and dynamic offsets. Upload all occupied ranges before submitting the matching encoder. Reuse a bounded number of pages after submission in queue order and retire overflow via the existing completion fence. Check draw-time values across programs, pages, and submissions.
3. Implement a narrower path for the measured Rust transport cost. Preserve argument conversion, limits, errors, null/stale handles and context isolation. Use existing semantic operations and original uniform/draw tests to verify the change.
4. Smoke-test both changes independently. Collect native, baseline, host-only, Rust-only and combined variants with isolated contexts, rotated order, 30 warmups and 120 sampled frames over three rounds. Use matching Wasm builds and identical scene poses and retain raw samples and screenshots under `artifacts/uniform-dispatch`. Report CPU p50/p95, rAF cadence, bind groups, uploads, submits and exact image comparison against the Refral baseline. Store profile runs separately from measurements.

Acceptance requires `pnpm check`, actual-Wasm adapter tests for Rust transport changes, focused and full headless Chrome regression, a built deployment check, and relevant original CTS against the prior accepted baseline. Use the same exclusive GPU slot for each local GPU run. Land measured improvements as independent, atomic commits through the required PR check.

## Profile and implementation

In a separate Shapes CPU capture, Rust's general `command` stack accounted for 1,616 ms of the 2,616 ms sampled inside frame steps. Uniform setters accounted for about 525 ms of the general command samples, VAO binding 241 ms, and program switches 180 ms. The remaining samples include draw and surface commands. Shared `uniformGroup` calls accounted for about 209 ms on each core. This diagnostic used Chrome DevTools Protocol sampling at a requested 101 μs interval. The raw profiles and stack aggregation are under `artifacts/uniform-dispatch/2026-11-21T12-44-31.257Z/` and `artifacts/uniform-dispatch/profile-summary.json`.

The shared host stages each draw's uniforms at the device's required alignment and uploads one occupied range per page before submitting its encoder. Two 256 KiB pages can be retained and reused in queue order, with one CPU staging allocation and one GPU buffer per page. Overflow pages retire through the existing completion fence. Bind groups are reused by page and program layout. The additional alignment padding is included in uploaded-byte measurements.

Rust direct command protocol v1 sends scalar uniforms, VAO binding and current surface dimensions as typed Wasm arguments. Array and matrix setters transfer the f32 or i32 words through a Rust-owned input range. The operations call the same Rust validation and mutation methods. Program changes and draw replies retain the general transport because they can carry artifact and resource records. The adapter can still use the original path with earlier ABI7 builds. The measured core Wasm grows by 2,325 bytes, from 356,088 to 358,413 bytes.

## Controlled comparison

Chrome 158.0.8127.36 headless on Apple M4 Max (Metal), one exclusive hardware slot. Three rounds rotated variants and ran 30 warmups and 120 sampled rAF callbacks per variant. The table shows medians of the three per-round CPU p50 / p95 results in ms per frame. Samples include animation updates, renderer calls and `gl.flush()`. GPU completion and the final screenshot are outside the sample interval.

| Scene / core | Native WebGL | Before | Host only | Rust transport only | Both |
| --- | ---: | ---: | ---: | ---: | ---: |
| Four-view Shapes / JS | 2.105 / 2.780 | 4.520 / 4.845 | 4.465 / 4.925 | — | 4.465 / 4.925 |
| Four-view Shapes / Rust | 2.105 / 2.780 | 10.790 / 12.305 | 10.015 / 11.410 | 6.630 / 7.370 | 6.415 / 6.915 |
| Triangle cloud / JS | 0.335 / 0.560 | 1.150 / 1.610 | 1.005 / 1.880 | — | 1.005 / 1.880 |
| Triangle cloud / Rust | 0.335 / 0.560 | 1.575 / 2.155 | 1.800 / 2.280 | 1.530 / 2.005 | 1.655 / 2.120 |

The JS `Both` cells use the host-only measurements since the Rust transport change only runs on that core. All 42 runs executed identical Three.js workloads and animation poses. Both optimizations retained byte-exact pixels against each core's baseline, and the native comparison retained the baseline result. The triangle cloud matched native exactly. The Shapes maximum difference remained 1,177 of 1,920,000 pixels above two RGB levels.

Shapes averaged 369 draws and one submit per frame in every Refral variant. The host change reduced new bind groups from 422.18 to 53, with uploads rising from 80,669 to 189,070 bytes per frame because of dynamic-offset alignment. Host-only Rust p50 improved 7%, while JS p50 and p95 moved about 1% and 2% in opposite directions. Rust transport-only p50 improved 39%, and both changes reduced Rust p50 by 41% and p95 by 44%. With the transport change held fixed, the host improved Rust Shapes p50 in each round. In the two-draw triangle cloud, frame CPU timings were mixed and the combined Rust p50 was 0.080 ms higher with a 0.035 ms lower p95. rAF cadence stayed near 60 Hz on all backends.

The archive checkouts, exact revisions and Wasm hashes, raw samples and paired screenshots are in `artifacts/uniform-dispatch/2026-11-21T12-51-31.991Z/`. For another matched run, use the comparator path `artifacts/uniform-dispatch/compare.mjs` with the baseline, host-only, Rust-only and combined revisions stored in that run's `summary.json`. `pnpm bench:three:heavy` remains the entry point for running either scene on the current checkout.

The initial Rust-only smoke's source overlay was skipped by Git when run inside the archived subdirectory. The formal run used a separate verified Git tree for Rust-only, with the baseline host and matching direct-command Wasm. The table uses the formal runs.

## Verification

`pnpm check`, `pnpm ci:check`, 222 headless Chrome tests, `pnpm build` and the headless production deployment checks passed. The actual-Wasm integration suite passed all 55 tests against the new module and all 55 with the earlier ABI7 module. The deployment check loaded direct command protocol v1 from the packaged module.

The 142 selected original WebGL 1.0.4 files ran on each backend. Native passed 140, and JS and Rust each passed 133. Every outcome and pass/fail/skip assertion count matched the corresponding previous case, using [task 120](120-geometry-cache-and-batched-publication.md#verification) where available and the preceding full extension checkpoint for uniforms. All 30 uniform files passed on all three backends. The 505,000-draw test passed its 12 assertions on each backend, taking 1.69 seconds on native, 2.10 seconds on JS and 4.53 seconds on Rust. These are individual CTS wall times. Raw original results and screenshots are under `artifacts/uniform-dispatch/cts/`, with the comparison in `artifacts/uniform-dispatch/cts-comparison.json`.

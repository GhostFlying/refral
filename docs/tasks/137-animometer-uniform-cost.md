# 137 Animometer uniform and draw CPU costs

Measure fixed per-draw cost and the marginal cost of active scalar uniform writes on the task 136 Mini baseline. Own the opt-in external benchmark variants, page audit and the measured hot path selected after attribution. Keep the upstream sources pinned and unmodified. Reuse the WebGL subset contract, ordered draw semantics and actual Rust module.

Use the original shader, buffer and 20,000 triangle draw calls. Initialize all six locations each frame. Sweep 0, 1, 3 and 6 varying uniform1f writes inside the loop. Keep images comparable across the sweep and audit actual call counts. Include a clear/setup-only reference for frame overhead and the unmodified upstream workload for external validity. Measure native, JS and Rust headless on the hardware adapter under the shared GPU lock, one worker, three rounds, 30 warmup and 120 timed frames. Compare p50/p95, fixed cost and marginal costs. Optimize the largest measured excess and repeat affected measurements. Check retained pixels and GL errors, pnpm check, ci:check, actual Wasm when applicable and Chrome regression tests.

The first complete round identified excess per-uniform CPU cost as the largest contributor on the six-write JS workload. With Rust, the zero-write draw loop was more expensive than the incremental six writes. Test link-time JS uniform write layout preparation and scalar facade conversion for the former. For the latter, test extending the host's resident geometry shortcut to ordinary non-indexed draws with versioned vertex inputs. Retain resource version checks, synchronous input consumption and per-draw uniform snapshots. Verify each step independently and remeasure the combined build.

## Method

The opt-in cases specialize only the pinned WebKit-derived Animometer scalar loop served by the external harness. The shader, triangle, two vertex streams, canvas, program, calls to clear and explicit flush remain common. Six active floats are set once per frame. In the loop, the first k locations are written with precomputed Float32 inputs alternating between adjacent representable values for each successive triangle. The shader executes live uniform reads, and each treatment produces the same nonempty screenshot. This controlled triangle distribution differs from the upstream animated field, which is measured separately without modifying its loop or input data. The setup-only case performs the same six frame-level writes and clear/flush, with zero draws. Counting wrappers are installed only for the untimed audit frame. The sweep checks actual calls (6 + 20,000k) and hardware draw counts on both cores.

Hardware is the Apple M6 Mini with Chrome 158.0.8127.37 headless on Metal. One hardware GPU worker holds the exclusive measurement lock. Each cell pools 360 frames from three independent pages with 30 warmup frames and 120 samples. Backend launch order rotates by round. The main-thread timer covers the animation callback, application data reads, API conversion/validation, JS or actual Wasm processing, host encoding and flush including CPU backpressure. GPU completion, audit and screenshot are outside that interval. The observed timer resolution is recorded per route in the JSON. Upload work in every 20K sweep cell was 10,230,464 bytes, 40 bind groups and one submission per frame on each core.

For each backend let S, D0 and D6 be the measured setup-only, zero-write and six-write p50. Estimate fixed draw-loop time as D0 minus S and six-update time as D6 minus D0. These endpoint differences include input reads, call overhead, and any scheduling/backpressure change. Per-call estimates divide by 20,000 draws or 120,000 setters respectively. The native one-write p50 was below its zero-write p50 in the baseline. Intermediate differences should not be interpreted as a universal linear setter cost.

## Baseline attribution

| Component, ms/frame | Native | JS | Rust |
| --- | ---: | ---: | ---: |
| Setup only | 0.020 | 0.165 | 0.170 |
| Fixed 20K draw loop | 1.610 | 19.770 | 20.755 |
| Six writes per draw | 1.270 | 33.490 | 16.935 |
| Fixed ns/draw | 80.5 | 988.5 | 1037.8 |
| Incremental ns/setter | 10.6 | 279.1 | 141.1 |

Relative to native, JS spent an extra 32.220 ms/frame on six writes and 18.160 ms/frame on the draw loop. Rust spent an extra 15.665 and 19.145 respectively. At 39a4bde, preparing JS stage views, type/layout metadata and writing only the changed elements reduced JS D6 to 39.615 ms with D0 at 19.890. Link generation and location checks still precede writes. Queued draws own their uniform bytes. The unmodified JS workload measured 39.405 ms at this step.

At 626163e the facade converts one scalar argument directly, preserving location unwrap, numeric conversion and arity checks. JS D6 measured 34.950 ms and Rust D6 33.505 ms; unmodified upstream measured 34.375 and 33.450 ms. At 7806c64 the host extends its existing resident stream shortcut to ordinary drawArrays. Reuse requires the same packed prefix length and matching ordered stream identities, formats, offsets and strides. Unversioned attributes, expanded geometry and nonresident working sets still take the general path. The three-backend regression explicitly alternates drawArrays and drawElements, first vertex, pointer offsets, buffer writes and constant attributes.

## Complete measurements

Pooled nearest-rank CPU p50 / p95, ms/frame, on the Mini. Native runs were repeated with the final sources.

| Updates per draw | Native before | JS before | Rust before | Native after | JS after | Rust after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Frame setup | 0.020 / 0.040 | 0.165 / 0.255 | 0.170 / 0.325 | 0.020 / 0.040 | 0.145 / 0.230 | 0.175 / 0.285 |
| 0 | 1.630 / 1.675 | 19.935 / 21.220 | 20.925 / 22.315 | 1.610 / 1.650 | 15.380 / 20.705 | 16.360 / 17.465 |
| 1 | 1.510 / 1.755 | 25.060 / 26.295 | 24.010 / 25.505 | 1.500 / 1.525 | 18.040 / 19.285 | 18.515 / 19.740 |
| 3 | 1.835 / 2.430 | 35.945 / 37.295 | 29.510 / 31.180 | 2.180 / 2.550 | 23.225 / 24.465 | 22.920 / 24.135 |
| 6 | 2.900 / 3.630 | 53.425 / 54.870 | 37.860 / 39.425 | 2.940 / 3.625 | 30.250 / 31.405 | 29.005 / 30.110 |
| Upstream (6) | 2.920 / 3.665 | 53.380 / 54.535 | 37.895 / 39.420 | 2.930 / 3.640 | 29.920 / 31.150 | 28.880 / 29.970 |

| Final attribution | Fixed draw loop, ms/frame | Six updates, ms/frame | Fixed ns/draw | Incremental ns/setter |
| --- | ---: | ---: | ---: | ---: |
| native | 1.590 | 1.330 | 79.5 | 11.1 |
| js | 15.235 | 14.870 | 761.8 | 123.9 |
| rust | 16.185 | 12.645 | 809.2 | 105.4 |

Across the final upstream workload the median fell by 43.9% on JS and 23.8% on Rust. The respective native ratios remain 10.2x and 9.9x. On the controlled six-write frame, fixed draw work accounts for 50.6% of JS and 56.1% of Rust after subtracting setup. Per-setter figures are average costs of the zero-to-six contrast. The JS zero-write p95 remains 20.705 ms; 22 of 360 final samples exceeded 20 ms across three rounds. The cause of those slower frames was not isolated. All controlled draw captures matched the native zero-write PNG byte for byte across counts, revisions and backends, and the upstream captures matched the separate upstream native PNG. Host upload bytes, bind group counts and submits matched their baseline counterparts per round.

## Reproduction

From the Mini checkout with its pinned compiler and actual core Wasm, use the same command on the benchmark-only revision 79b75af and on the final code revision:

```sh
source artifacts/draw-snapshot-release/handoff/mini-env.sh
export REFRAL_TEST=1 REFRAL_BENCHMARK=1
export REFRAL_CASES=animometer-setup,animometer-uniforms-0,animometer-uniforms-1,animometer-uniforms-3,animometer-uniforms-6,animometer
python3 artifacts/geometry-performance/lock.py node tools/external-benchmarks.mjs
```

Timing directories under `artifacts/external-benchmarks/` end in `09-39-00.763Z` (before), `09-43-15.275Z` (JS layout only), `09-44-08.396Z` (scalar facade) and `09-45-22.914Z` (combined). They contain environment and Wasm hashes, original frame samples, counters and screenshots. The Mini's `artifacts/uniform-cost/report.py` verifies PNGs and API counts and writes pooled and per-round results to `results.json`.

## Verification and delivery

The Mini passed pnpm check (248 CPU unit tests and 77 native Rust tests), ci:check, all 73 actual-Wasm tests, all 232 single-worker headless Chrome tests, the distribution build and test:dist. All 32 selected original CTS files passed individually on native, JS and Rust (96/96 file/backend runs). The selector covers conformance/uniforms and the drawArrays/drawElements out-of-bounds rendering tests. The raw evidence is under `artifacts/uniform-cost/`, including `cts/` and the verification logs. [Delivery PR 120](https://github.com/GhostFlying/refral/pull/120)

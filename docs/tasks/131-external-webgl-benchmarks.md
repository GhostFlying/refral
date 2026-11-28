# External WebGL1 benchmarks

Base `d088d4a`. Import pinned community workloads and run the original application code on native WebGL1 and on the JS and actual Rust polyfills. The integrating owner maintains the acquisition pins, runner, bootstrap and report. Task 132 separately investigates point coverage.

1. Inspect licenses and pin the sources for Aquarium (default and 20K), Animometer (default and attributes), Dynamic Cube Map and Unity. Check Basemark's distribution terms.
2. Prepare the selected implementation before page startup. Capture actual context, frame work, pixels, CPU callback and frame intervals. Identify startup/profile gaps per route.
3. Use headless Chrome and the shared exclusive GPU lock. Rotate three rounds with 30 warmup and 120 sampled frames. Compare like work and report the native-relative baseline and evidence.
4. Run the affected checks, `pnpm ci:check`, and deliver through the required PR check.

## Reproduction and timing

Build the pinned compiler and Rust core as described in the repository README. Install Playwright's Chrome channel. Run the following commands from the repository root. The benchmark takes the same file lock as the Mini conformance campaign.

```sh
pnpm bench:external:deps
pnpm bench:external
run_dir=$(ls -dt artifacts/external-benchmarks/20*/ | head -1)
pnpm bench:external:report "$run_dir"
REFRAL_CASES=animometer-attrib REFRAL_BACKENDS=native pnpm bench:external
REFRAL_CASES=unity REFRAL_ROUNDS=1 pnpm bench:external
```

The default set contains Aquarium (500 fish and the upstream `numFish=20000` option), the WebKit-derived fixed-work Animometer extraction (20,000 uniform draws and a labelled 256-triangle attribute diagnostic), and Dynamic Cube Map. The original 20,000-triangle attribute workload remains selectable as `animometer-attrib`. The smaller diagnostic changes one upstream `tune` argument. Aquarium uses its WebGL1 mode with VR disabled. All three routes request antialiasing off.

Each route gets a fresh browser context. The runner prepares the selected polyfill in the application's realm before loading the original scripts and assets from localhost. In the five frame-based workloads it seeds the random generator and advances simulation time by 1/60 second per frame. It schedules each frame on a real browser animation callback. Native WebGL1, Refral JS, and Refral's real Rust Wasm rotate their running order each round. Unity uses its own real-time loop, scores, and six-minute AreWeFastYet limit.

CPU time covers the original application's animation callback and explicit flush, including its JS scene updates, API input handling, and CPU-side encoding/submission or driver backpressure. Samples exclude initialization, 30 warmup frames, final GPU queue wait, draw audit and screenshot. Frame intervals measure successive browser animation timestamps. GPU duration and compositor presentation latency were unmeasured. Screenshots capture the visible canvas element at device scale 1 in an 800 × 600 viewport. The drawing buffers were 1024 × 1024 for Aquarium and Dynamic Cube Map and 800 × 600 for Animometer. Each paired screenshot uses the same additional audit frame after 120 samples.

## Build and source provenance

Mini runtime `d088d4a`, Apple M6, macOS 27.2.1, headless Chrome 158.0.8127.37, Node 24.14.0 and Playwright 1.65.0. Native reported ANGLE Metal on Apple M6. Both polyfills reported Apple Metal 3 hardware. The normal measured timer step was 0.005 ms. The ANGLE Wasm SHA-256 was `d62226acfc67938a6d5cec1e5ee0e9c56d99636e2151ba097eafc73a03bf2a14` and the Rust core was `52c5af557e5603784300e62a47a463c398702e7a7cc4d6c444744149dc3ff3e1`.

- Aquarium and Dynamic Cube Map use WebGL Samples at [6d56695](https://github.com/WebGLSamples/WebGLSamples.github.io/tree/6d56695888ec72b1ef2674498e307f1ab4310226).
- Animometer uses the standalone fixed-size WebGL workload at [8635561](https://github.com/kenrussell/webgl-animometer/tree/86355610e801bceb0b4f4da465c29699690b5b6f).
- Unity WebGL 0.1 uses the Mozilla AreWeFastYet player at [0e21608](https://github.com/mozilla/arewefastyet/tree/0e2160885d0ca693577d54f1bbbe572f052282c6/benchmarks/unity-webgl).
- Basemark Web 3.0 has no locally licensed distributable in this workspace. Its published terms restrict copying and specify usage by license tier. Adding a local polyfilled test needs permission covering this use. [Basemark Web terms](https://web.basemark.com/tos)

## Mini results

The table gives pooled nearest-rank CPU p50 / p95 in milliseconds per frame. Each timed cell has 360 samples. Draws are API calls in the untimed final frame, verified on all three routes in every round. The two right columns give CPU p50 divided by native p50.

| Workload | Draws | Native | Refral JS | Refral Rust | JS/native | Rust/native |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Aquarium 500 | 610 | 1.245 / 1.465 | 4.995 / 5.325 | 13.440 / 14.130 | 4.01× | 10.80× |
| Aquarium 20,000 | 20,110 | 3.555 / 3.965 | 166.665 / 170.790 | 459.295 / 463.040 | 46.88× | 129.20× |
| Animometer uniforms 20,000 | 20,000 | 2.630 / 3.160 | 53.890 / 55.325 | 37.945 / 39.670 | 20.49× | 14.43× |
| Animometer attributes 256 (scaled) | 256 | 0.055 / 0.075 | 5.580 / 6.035 | 5.725 / 6.115 | 101.45× | 104.09× |
| Animometer attributes 20,000 (original) | 20,000 native | 0.955 / 1.630 | startup timeout | startup timeout | — | — |
| Dynamic Cube Map | 176 | 0.555 / 0.710 | 2.715 / 4.530 | 3.780 / 5.060 | 4.89× | 6.81× |

| Browser animation interval, p50 / p95 ms | Native | Refral JS | Refral Rust |
| --- | ---: | ---: | ---: |
| Aquarium 500 | 16.66 / 16.67 | 16.66 / 16.67 | 16.66 / 16.67 |
| Aquarium 20,000 | 16.66 / 16.67 | 166.66 / 183.32 | 466.64 / 466.65 |
| Animometer uniforms 20,000 | 16.66 / 16.67 | 50.00 / 66.66 | 33.34 / 50.00 |
| Animometer attributes 256 | 16.66 / 16.67 | 16.66 / 16.67 | 16.66 / 16.67 |
| Dynamic Cube Map | 16.66 / 16.67 | 16.66 / 16.67 | 16.66 / 16.67 |

All 45 timed runs completed with zero final GL errors and empty captured page and Refral error lists. The audit captures covered 480,000 pixels. Both Animometer cases matched native RGB exactly. Dynamic Cube Map had at most 13 pixels above RGB delta 2 against native and one between the cores. Aquarium had 9,098 pixels (1.895%) above delta 2 at 500 fish and 7,760 (1.617%) at 20,000 fish, above the 0.2% tolerance previously used for Three.js. The JS and Rust Aquarium screenshots matched each other in all three rounds. The Aquarium timings describe successfully executed, draw-count-matched workloads. A [follow-up image investigation](133-aquarium-image-analysis.md) attributes most of the above-threshold pixels to the generated mip levels of the inner tank normal map.

Aquarium 20,000 and Animometer uniforms have similar draw counts. Their shared-host counters show 20,167 versus 40 bind groups per frame, about 10.31 versus 10.23 MB uploaded, and one submission each. This identifies substantially different binding work at similar draw and upload volumes. It does not isolate the cause of the extra Rust CPU cost in Aquarium. The 256-draw attribute variant uploaded 5,262,672 bytes per frame on both cores. Its native p50 spans only about eleven timer steps.

At the original attribute size native completed all three rounds with a 16.66 / 16.67 ms browser interval. Both polyfills timed out before the first scheduled sample at a 45-second readiness limit. The source requests seven attribute streams with monotonically increasing `drawArrays(first, 3)` offsets. The shared host includes the required vertex-prefix length in the geometry cache key, so successive draws miss and repack or upload overlapping prefixes. The seven streams occupy 52 bytes per vertex. Preparing exact prefixes for 20,000 draws would involve about 31.2 GB of vertex data per frame before uniforms. This is a source-derived estimate. The recorded 256-draw counters and timeout are measurements.

Per-frame samples, route configuration, host counters, audit captures and `summary.json` are under `artifacts/external-benchmarks/2026-11-28T07-52-05.321Z/`. Original attribute startup controls are in `2026-11-28T07-48-06.364Z/` and its native full-length reference is in `2026-11-28T08-00-47.806Z/` alongside that directory. Task 130's Three.js measurements remain a distinct workload family.

## Unity and verification

All three routes started the original Unity 5.0.0b14 player and displayed the Mandelbrot GPU scene. Each independently reached the upstream six-minute limit with an empty Mozbench results list. All three logged the same fragment shader diagnostic rejecting a `while` loop at line 22. The evidence establishes the shader rejection and missing scores independently. The JS and Rust player canvases reported 85,665 and 85,657 draws respectively, hardware adapters and empty host error lists at timeout. There is no paired Unity score for this configuration. The full route evidence is in `artifacts/external-benchmarks/2026-11-28T08-01-54.381Z/`, with separate startup screenshots in `2026-11-28T08-01-00.132Z/`.

`pnpm check` passed TypeScript, 248 unit tests, 76 tooling tests, 77 native Rust tests, rustfmt/Clippy and support validation. `pnpm ci:check` passed. The acquisition pins, runner and report were exercised on the Mini. The companion [Shapes point investigation](132-shapes-point-root-cause.md) records the separate coverage experiment. [Delivery PR 115](https://github.com/GhostFlying/refral/pull/115)

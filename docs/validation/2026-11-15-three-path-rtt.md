# Three-path render-to-texture acceptance

Local acceptance completed on 2026-11-15 under task 020. Automatic PR delivery and integrated heads are recorded in artifacts/rtt/delivery.json.

## Scope and environment

The milestone extends main 75705f9 through the same pinned WebGL Fundamentals render-to-texture scene on native WebGL, Refral JS and Refral Rust. The public factory remains asynchronous with JS as the default. Every supported GL call executes synchronously after initialization. An explicitly selected Rust context executes its semantic operations in Rust.

The shared profile includes float/int/bool scalar/vector arrays, mat2/mat3/mat4, scalar sampler2D, level-zero UNSIGNED_BYTE RGBA/RGB/ALPHA/LUMINANCE/LUMINANCE_ALPHA uploads from TypedArray/null, unpack state, RGBA texture color targets with optional DEPTH_COMPONENT16 renderbuffers, raster state and explicit resource lifetimes. The original 3×2 LUMINANCE upload, matrices, culling, depth and two-pass scene remain intact.

Local verification uses headed Chrome 157.0.8103.51, one Playwright worker, DPR1 and the Apple Metal hardware adapter. Runtime records contain actual adapter/fallback status, native unmasked renderer when available, context attributes, browser launch arguments, source/build hashes and capabilities. Node 24.14.0, pnpm 10.12.3 and Rust 1.94.1 remain pinned.

The demo revision is fd4401e2741a68ebb7c3beb33ed064a5859d22d7. WebGL specification, IDL and original CTS use revision 39443210f7f81db4773eb104facadfb85d05dfa4. GLES 2.0.25 and ESSL 1.00 supply inherited semantics.

## Resource and transport boundary

Texture, renderbuffer and framebuffer wrappers carry context-owned typed generational handles. Each semantic core owns bindings, validation, attachment references and versions. A shared per-context ExecutionResources registry resolves ordered resource operations to the common WebGPU executor.

Definitions and subimage updates carry independent RGBA pixel data. Draws reuse stable version references. GPU framebuffer writes advance content versions while retaining their rendered allocation. Later sampling and subimage copies consume that GPU content in call order. Storage replacement and final retirement preserve queued resource lifetimes. Deletion detaches the currently bound framebuffer's matching references and retains references held by other framebuffers until their final release.

The private Wasm ABI is v3. Resource protocol capability v1 introduced texture operations and v2 adds offscreen targets. The adapter checks the exact capability before initialization. It validates bounded metadata, frame lengths, typed handles, versions and pixel pointer ranges, then copies output pixels before arena reuse. Rust reserves bounded operation headers before committing texture storage. Typed i32 payloads preserve integer precision, while matrix and array packing use compiler reflection strides. ADR006 records these decisions.

## Specification corrections

The work corrects complete excess uniform-array updates, float-to-bool conversion including NaN, first-bind object identity, nullable texSubImage2D error behavior, 1×1 mip-chain completeness, attachment query errors, repeated deletion with unbound retained FBO references and current-framebuffer component-bit queries. Public texture-unit constants cover TEXTURE0 through TEXTURE31.

The full signed-integer GPU scene exposed the pinned ANGLE WGSL emitter producing an invalid literal for INT_MIN. A recorded idempotent source patch emits a valid signed expression. The exact ESSL regression remains in the compiler corpus and real pipeline coverage.

Legal depth-only and RGB framebuffer combinations return FRAMEBUFFER_UNSUPPORTED within the declared RGBA execution profile. Invalid or undefined images and dimension mismatches retain their distinct completeness statuses. Depth backing uses depth24plus and reports 24 bits for DEPTH_COMPONENT16, satisfying its minimum precision.

## Verification commands and evidence

```sh
pnpm check
pnpm rust:build
pnpm rust:test:wasm
pnpm compiler:test
pnpm test:chrome
pnpm build
pnpm test:dist
pnpm bench:rtt
```

Eleven unchanged original CTS files pass 243 assertions per backend after the uniform slice. Every file retains its upstream identity and actual assertion list in `artifacts/cts/results.json`. Texture/FBO upstream cases retain their synchronous readback, CubeMap, mipmap, packed-format, image-copy and renderbuffer-format prerequisites in the fixture lock. Source-derived asynchronous project scenes retain separate identities.

The shared RTT suite contains twenty state/error/image scenes. The pinned demo uses one 320×240 context per backend and sequential times 0/1000/2000. Native comparisons use two-byte per-channel tolerance with a one-pixel edge neighborhood. JS/Rust comparison is pixel-exact. Images, differences, shaders, attributes and build hashes live under `artifacts/rtt/` and `artifacts/demo/`. Built deployment evidence lives under `artifacts/deployment/`.

## Accepted results

| Verification | Result |
| --- | --- |
| TypeScript and support metadata | Passed |
| Deterministic CPU tests | 107 passed across 16 files |
| Native Rust, formatting and clippy | 44 passed, checks clean |
| Actual Wasm | 20 passed across Buffer and drawing/resource/FBO suites |
| Compiler corpus and real pipelines | 24 corpus cases and four real shader pairs passed |
| Final Chrome correctness | 84 passed, zero failed/skipped |
| Original CTS | Eleven files, 243 assertions on each of native/JS/Rust |
| Shared RTT scenes | Twenty passed all state/error/region and exact JS/Rust checks |
| Sequential demo | Nine pair comparisons at three times, zero observed byte/pixel differences |
| Built deployment | Three-path RTT/triangle pixels, GPU probe, ABI3/protocol2 and page-error checks passed |
| Repeated performance | 45 passed, 5400 measured CPU samples, all 45 final-image comparisons passed |

PR4 also ran the retained legacy benchmark within an 85-test full suite. PR5 moves that benchmark's three workloads into the expanded independent runner, leaving 84 correctness tests. Logs are `artifacts/rtt-pr4-regression.log`, `artifacts/rtt-final-{check,wasm,compiler,chrome,build,dist}.log` and `artifacts/rtt-performance.log`.

The final Rust Wasm is 282,639 bytes, ABI3/resource protocol2, with no imports. Its SHA-256 is e407526a05e998a987c90de691d5f679494df7b3ec27b1501693f27815d982ea. Compiler Wasm SHA-256 is 954a24680f8a5a799dd2d72dd66193b56526ec96047f6cc2badf247836f0a49f. The benchmark snapshot records source-tree SHA-256 3d36dca5f4fff6b2f2082830fea916c796aca02e2bbf9e4bacdd8e57efa11dec under `artifacts/benchmarks/rtt/source.json`.

## Performance protocol

The independent entry runs five workloads across native/JS/Rust in three rotated backend orders, producing 45 records. Every record contains a separate first frame, 30 warmup samples and 120 measured samples with eight logical frames per sample. Uniform, state, dynamic Buffer and dynamic texture workloads execute 64 draws per 64×64 logical frame. RTT replays the original scene's prepared public GL calls at the same 64×64 capture size.

Typed input creation and RTT matrix/scene calculation occur before timed replay. CPU intervals include public method lookup/dispatch, conversion, snapshots, Wasm bridge work, encoding and explicit flush. Full 64×64 RGBA readback and GPU-completion pacing occur after the interval. Recorded CPU samples use ms/logical-frame. Context initialization, shader/resource preparation, first-frame CPU and first completed image have separate timing fields.

Reports retain raw samples, nearest-rank p50/p95, timer resolution, input sizes, cache state, hardware/browser configuration, upload/pipeline/bind-group/pass/copy/submit counters and host resource capacity estimates. GPU timestamp durations are unavailable in this CPU baseline and availability/reason are recorded. Driver VRAM, browser process memory and total JS/Rust heap usage remain separate unmeasured quantities. The results retain native unavailable-counter reasons.

Raw performance records and the round summary live under `artifacts/benchmarks/rtt/`. Each run records its source-tree hash and the Rust/compiler/demo adapter hashes. Browser contexts are fresh per record, the Chrome process is retained, and GPU-driver caches remain unmanaged.

## Observed CPU baseline

The accepted sample uses Apple M4 Max, 16 logical CPUs, 128 GiB RAM, Darwin 25.6.0 and headed Chrome 157.0.8103.51. Native reports ANGLE Metal Renderer Apple M4 Max, and both WebGPU backends report apple/metal-3 with isFallbackAdapter=false.

The first 45-run capture used the default 0.1 ms timer and quantized some native medians to zero. Those records remain under `artifacts/benchmarks/rtt-coarse-timer/`. The accepted capture enables COOP/COEP on the independent benchmark server and records crossOriginIsolated=true with an observed minimum positive timer step near 0.005 ms. All backends use that configuration. The ordinary correctness/deployment server uses its regular headers.

Each cell below is pooled nearest-rank p50 / p95 in ms/logical-frame over 360 measured samples from three rounds. Each sample covers eight logical frames.

| Workload | Native | JS | Rust |
| --- | --- | --- | --- |
| uniform-draws | 0.0062 / 0.0075 | 0.2919 / 0.3413 | 1.0713 / 1.1731 |
| state-changes | 0.0100 / 0.0113 | 0.3144 / 0.3537 | 1.4544 / 1.6556 |
| dynamic-buffer-upload | 0.0144 / 0.0150 | 0.3850 / 0.4356 | 1.0888 / 1.2056 |
| dynamic-texture-upload | 0.0194 / 0.0213 | 1.0100 / 1.1481 | 2.3475 / 2.6225 |
| render-to-texture | 0.0025 / 0.0031 | 0.0531 / 0.0637 | 0.1688 / 0.2025 |

The current Rust implementation has higher CPU costs than JS in every sampled workload. The combined API/core/bridge/executor intervals require separate profiling to attribute that difference. Optimization is a subsequent task. Native ratios and each round's p50/p95 remain in `summary.json`, while `aggregate.json` retains the pooled values.

The table below reports the median of three observed initialization/first-frame values for each workload/backend, all in milliseconds. Context initialization and shader/resource preparation have separate intervals. First-image completion starts at first-frame replay and includes its readback wait. Fixture/input preparation and since-start timings remain in every raw record.

| Workload | Backend | Context init | Shader/resources | First-frame CPU | First image complete |
| --- | --- | --- | --- | --- | --- |
| uniform-draws | native | 2.535 | 0.880 | 0.050 | 0.875 |
| uniform-draws | js | 15.830 | 14.800 | 2.435 | 6.510 |
| uniform-draws | rust | 23.145 | 15.605 | 4.605 | 9.695 |
| state-changes | native | 2.590 | 0.895 | 0.070 | 1.085 |
| state-changes | js | 15.305 | 14.970 | 2.285 | 7.695 |
| state-changes | rust | 22.575 | 15.490 | 5.195 | 10.765 |
| dynamic-buffer-upload | native | 2.505 | 0.845 | 0.070 | 1.110 |
| dynamic-buffer-upload | js | 14.800 | 14.670 | 2.455 | 6.775 |
| dynamic-buffer-upload | rust | 23.195 | 15.155 | 4.380 | 8.975 |
| dynamic-texture-upload | native | 2.545 | 1.090 | 0.095 | 2.725 |
| dynamic-texture-upload | js | 15.860 | 16.010 | 3.695 | 12.115 |
| dynamic-texture-upload | rust | 22.680 | 16.510 | 6.580 | 14.620 |
| render-to-texture | native | 2.180 | 2.635 | 0.115 | 1.040 |
| render-to-texture | js | 8.630 | 20.160 | 2.170 | 6.460 |
| render-to-texture | rust | 16.165 | 18.135 | 2.360 | 7.385 |

GPU timestamp support is available on the adapter and remains disabled on the benchmark device. GPU durations were not sampled. Native timer-extension availability is recorded independently. Capacity estimates cover tracked host buffers/textures and prepared inputs. They exclude driver allocation details and total language-runtime heaps. These boundaries apply to every timing/counter comparison.

## Execution counters and capacities

The following round-one counters are normalized per measured logical frame. Pass/copy/submit counts agree between the two semantic cores. All measured pipeline-creation counts are zero after warmup. Total counters retain initialization and first-frame pipeline creation separately.

| Workload | Draw/pass/copy/submit | JS uploaded bytes | Rust uploaded bytes | JS peak buffer bytes | Rust peak buffer bytes |
| --- | --- | --- | --- | --- | --- |
| uniform-draws | 64/2/0/1 | 2160 | 5184 | 17280 | 41472 |
| state-changes | 64/2/0/1 | 2160 | 5184 | 17280 | 41472 |
| dynamic-buffer-upload | 64/2/0/1 | 5184 | 5184 | 41472 | 41472 |
| dynamic-texture-upload | 64/66/128/1 | 133232 | 136256 | 1065856 | 1090048 |
| render-to-texture | 2/3/0/1 | 1152 | 2016 | 263808 | 264672 |

Uploaded bytes count host buffer writes, including texture staging-row padding. GPU-to-GPU texture copies contribute copy counts. Prepared caller input sizes have their own fields. The dynamic-texture trace uploads 8×8 RGBA pixels on each draw and the current copy-on-write path splits passes around those updates.

For uniform/state workloads, Rust uploads 5184 host bytes per frame while JS uploads 2160. The current Rust packet decoder creates independent vertex byte arrays for each draw, while host vertex caching uses byte-array identity. This source mechanism explains the observed extra vertex upload volume. Combined CPU timing still requires profiling to quantify each contributor. RTT similarly records 2016 Rust versus 1152 JS uploaded bytes per frame. These observations are preserved for subsequent optimization.

Tracked peak texture-capacity estimates across both cores are 32768 bytes in the first three workloads, 164096 in dynamic texture and 294936 in RTT. Depth24plus allocation is implementation-defined, and these capacity estimates retain the host's width×height×4 convention. Raw records contain each backend/round's current and peak values.

## Remaining compatibility work

DOM image-source acceptance, mipmaps, CubeMap, packed and additional formats, broader framebuffer combinations, synchronous GPU readback, extensions and context restoration continue through subsequent spec/CTS tasks. The Dawn/C++ host adapter follows inspection of its actual command transport, threading and resource ownership interfaces.

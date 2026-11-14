# Render-to-texture verification and performance

Status is locally accepted on 2026-11-15. Task020 owns automatic delivery and its generated handoff.

## Goal and ownership

Implement shared native/JS/Rust verification, the pinned render-to-texture demo adapter, and an independently invoked five-workload baseline for task 020. This task owns fixture acquisition and selection, the CTS Chrome entry, new RTT fixtures and Chrome tests, the existing demo adapter/test, browser benchmark code and its independent runner, and this record. The integrating agent owns public interfaces, shared resources, UI selectors, root commands/build/deployment configuration, support reporting, and delivery.

## Plan

1. Audit the fixed WebGL/IDL/GLES rules and selected upstream tests. Acquire four additional original uniform CTS files through a preparatory lock list, preserving the seven-case executable list and its current assertion budget for PR1.
2. Hand off acquisition and source findings so the integrating agent can verify the existing 64 Chrome tests and JS demo before advancing the default Rust ABI.
3. At PR2, activate the four original uniform files and record their actual assertion totals. Document texture/FBO original-test prerequisites and map project regressions to their sources.
4. Add identical specification-derived state/error/pixel traces for typed uniforms and matrices, five texture formats and unpack behavior, updates/completeness/sampler units, FBO/raster/deletion/resize/context behavior, and ordered snapshots.
5. Extend the pinned demo to native/JS/Rust with a JS alias, selected-core checks, metadata and build hashes. Run the same prepared scene at 320×240, DPR1, times 0/1000/2000. Compare native with two-byte/one-pixel-edge tolerance and JS/Rust exactly.
6. Implement a separate performance runner for five workloads, three rotated backend rounds, 30 warmup samples, 120 measured samples and eight logical frames per sample. Exclude input preparation from intervals, include GL conversion/copy/bridge/encoding/flush, and pace with equivalent RGBA readback outside intervals. Record setup/first-image timing, raw samples, timer/cache/environment/counter/memory information and GPU timing availability.
7. Run CPU checks during implementation and coordinate exclusive Chrome correctness/performance windows with the integrating agent. Record exact results and capability gaps before delivery.

## Acceptance

Original CTS scripts and assertions remain intact. Shared fixtures verify specification expectations and retain reproducible native deviations. Demo frames have per-backend shader/configuration/image evidence. Performance results state exact units, timing boundaries, workload sizes, warmup/repetitions, pace/readback regions and unavailable measurements. PR1 preserves the current executable test selection, and later stages advance only with their stated implementation prerequisites.

## PR1 preparatory acquisition

The four original uniform files are recorded in `cts.preparedTests` at revision `39443210f7f81db4773eb104facadfb85d05dfa4`. The acquisition script fetches this list, while `cts.tests` continues to contain the existing seven files. The CTS runner and its current 100-assertion budget remain unchanged during this preparation.

`node tools/deps-fixtures.mjs` acquired all four files. They require only the existing `js-test-pre.js`, `webgl-test-utils.js`, `js-test-post.js`, and stylesheet resources. Their WebGL1 branches use synchronous state/query assertions and have no pixel-readback prerequisite.

The source audit identified these acceptance details for the semantic owners.

- `gl-uniform-arrays.html` accepts shorter complete updates and larger complete arrays, with extra array values ignored. It checks element queries, reflection names ending `[0]`, wide out-of-range location strings, malformed vector lengths, and wrong setter widths. Its integer/boolean/unsigned sections are WebGL2-only, so the WebGL1 project regressions supply the typed integer and boolean evidence required by task 020.
- `gl-uniformmatrix4fv.html` checks mat2/mat3/mat4 lengths, fixed shared inputs when available, and transpose rejection in WebGL1.
- `gl-uniform-bool.html` requires a float setter to accept a bool uniform.
- `gl-get-uniform-non-current-program.html` requires querying another program and querying while no program is current, including previously set values.

The existing JS uniform implementation rejects updates larger than the remaining uniform array capacity with `INVALID_OPERATION`. This conflicts with the selected original array test and GLES 2.10.4's excess-element rule. This finding is handed to the JS owner before activation.

## PR2 activation and evidence

PR1 preparation was accepted in commit `c9ea6e8` with the existing 64 Chrome regressions. At PR2 the four prepared uniform files moved into the executable `cts.tests` selection. The runner derives per-backend assertion totals from upstream results and checks equality with native. All eleven original files passed 243 assertions independently on native, JS and Rust.

The three shared uniform scenes cover mat2/mat3/mat4 array layout, transpose/length validation, mutable input snapshots, exact signed 32-bit values, scalar/vector integer setters, float-to-boolean conversion, non-current queries, excess array values and relink resets. The shared raster scene covers scissor/write masks, depth/depthMask, blending and culling with explicit expected regions. The full i32 draw exposed ANGLE emitting an invalid WGSL literal for INT_MIN. Integration corrected the pinned emitter and retained the exact INT_MIN regression.

Integration accepted the four shared scenes, eleven original CTS files and compiler GPU entry after rebuilding the compiler. Its complete stage-two suite passed 66 Chrome tests in 39.7 seconds. Compiler evidence contains 24 standalone cases and four real pipeline pairs. Logs are under `artifacts/rtt-pr2-*`. Commit `2d01d4c` activates the four uniform/raster scenes. Later-stage source fixtures remain prepared for their implementation slices.

## Texture and framebuffer verification preparation

The shared fixture now defines twenty native/JS/Rust scenes. Besides the four accepted uniform/raster scenes, it includes five UNSIGNED_BYTE texture formats with null storage and alpha, view offsets and mutation after upload, aligned/flip/premultiply unpacking, subimage updates and reallocations, NPOT completeness, sampler units and invalid upload atomicity. Framebuffer scenes cover depth rendering and subsequent sampling, attachment resizing/completeness, bound and retained-unbound deletion, feedback rejection, inactive-unit bindings, foreign contexts and canvas resize. Every scene specifies expected state/errors and full image-region coverage. JS/Rust images must match exactly, with explicit small native channel tolerances.

All paths request the same alpha/depth/stencil/antialias/premultipliedAlpha/preserveDrawingBuffer flags for each scene and assert the actual returned flags. The premultipliedAlpha presentation flag is true. Typed upload flip and premultiply state are exercised independently. Raw readback expectations retain the uploaded alpha values.

Original texture/FBO sources are acquired at the same CTS revision and recorded as prerequisite-not-run. The array-buffer upload source also needs synchronous readPixels, CubeMap and packed 16-bit formats. The NPOT source additionally needs mipmaps and copyTexImage2D. The attachment source needs color/stencil renderbuffer formats and both copyTexImage2D and copyTexSubImage2D. The feedback source needs synchronous readPixels. Source-derived asynchronous project regressions keep their own identities and are associated with these references in the lock file.

## Demo and independent performance entry

The pinned adapter accepts native, JS and Rust plus the existing refral-to-JS alias. It records the requested backend, actual selected core, shaders, actual attributes, initialization/resource timing and environment. The comparison runs one prepared 320×240, DPR1 scene per backend at times 0, 1000 and 2000. It writes nine raw frame/PNG results and nine pairwise comparisons. Native comparison uses the accepted two-byte/one-pixel-edge tolerance and JS/Rust comparison is exact. The UI smoke coverage retains the JS alias and adds Rust.

The independent benchmark config is `benchmarks/playwright.config.ts` and the runner is `tests/performance/rtt-benchmark.spec.ts`. Five workloads execute in each of three rotated native/JS/Rust orders, producing 45 records. Each run performs a separate first frame, 30 warmup samples and 120 measured samples, with eight logical frames per sample. That is 240 warmup and 960 measured logical frames. Uniform/state/buffer/texture workloads use 64 draws per 64×64 logical frame. RTT uses the pinned scene's GL trace and records its actual draw count.

Typed inputs and RTT matrix/scene computation are prepared before timing. CPU intervals include public GL dispatch, conversion/snapshots, bridge, encoding and explicit flush. Each interval is divided by eight and reported as ms/logical-frame. Full 64×64 RGBA capture paces every backend after the interval. Reports retain every CPU sample, nearest-rank p50/p95, setup/first-image timing, timer quantization, cache state, shader/configuration/build metadata, uploads/passes/copies/submits/pipeline/bind-group counters and memory estimates. GPU durations are recorded as unavailable in this CPU baseline with feature/extension availability. Native GPU allocation estimates are unavailable. The summary derives same-round native ratios and validates backend images after all 45 records are present.

The former single Chrome benchmark test is removed from the default correctness suite. Its native/JS uniform, state and dynamic-buffer coverage is included in the expanded independent runner. With all prepared RTT scenes and the Rust UI test active, the default entry contains 84 tests. The independent benchmark entry contains 45 tests.

## Final checks and acceptance

Integration passes 107 deterministic CPU tests, 44 native Rust tests, twenty actual-Wasm tests and the final 84-test Chrome correctness entry. All twenty shared RTT scenes pass. The original sequential demo's nine pair comparisons have zero observed byte/pixel difference. Eleven original CTS files retain 243 assertions on every backend, and built deployment verifies the probe, three-path RTT/triangles and packaged ABI3/resource-protocol2.

The independent 45-run benchmark passes all runs and final-image comparisons, retaining 5400 measured samples. The first complete capture exposed native timer quantization at 0.1 ms and is preserved under `artifacts/benchmarks/rtt-coarse-timer/`. The accepted entry enables benchmark-only COOP/COEP and observes approximately 0.005 ms resolution with crossOriginIsolated=true for all backends. Metadata captures Chrome's process ID through CDP and reads its actual OS command line. Source inventory, raw records, per-round summary and pooled values are under `artifacts/benchmarks/rtt/`.

The performance source snapshot and Rust/compiler/demo hashes identify the exact measured worktree. CPU p50/p95 use pooled nearest-rank over 360 samples per workload/backend. The dated report contains all fifteen initialization/resource/first-frame/first-image summaries, execution counters and capacity boundaries. GPU timestamp capability is available on the adapter, while this CPU baseline leaves GPU duration fields empty and records the device-feature state and reason. The root task owns final PR integration and generated delivery records.

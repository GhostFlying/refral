# Three-path render-to-texture

Status is running from main 75705f9.

## Goal and defaults

Implement the approved five-PR plan for native, JS and Rust render-to-texture. The public async factory defaults to JS and supported GL operations stay synchronous. Acceptance covers TypedArray/null level-zero UNSIGNED_BYTE uploads in RGBA, RGB, ALPHA, LUMINANCE and LUMINANCE_ALPHA, complete WebGL1 scalar/vector/array/matrix uniforms and scalar sampler2D, RGBA8 color/depth FBOs, raster state and resource lifetimes. DOM-source verification, mipmaps, additional formats, synchronous readPixels and restoration follow later tasks.

Retain the pinned specifications, compiler, demo and CTS revisions. The original demo requires 3x2 LUMINANCE, mat4, sampler2D, culling, depth and two passes.

## Ownership and implementation order

The integrating agent owns core-api, the facade, shared execution resources, BrowserHost, root entry points, documentation/support integration and Git delivery. A JS worker owns core-js semantics and typed resource adaptation. A Rust worker owns crates/core, crates/wasm, Cargo.lock and the rendering Wasm adapter/tests. A verification worker owns new fixtures, selected CTS acquisition, demo comparison, benchmarks and their package-local records. Every concurrent file has one writer.

1. Add typed texture/renderbuffer/framebuffer handles, a common ordered resource operation contract, stable execution records and JS migration. Preserve the existing 64 Chrome regressions and the JS demo.
2. Add Rust typed uniforms, matrices, scalar samplers, complete raster snapshots and private ABI v3. Update all ABI callers and run four additional original uniform CTS files.
3. Add Rust texture/unpack/update/completeness/sampling with matching five-format and lifetime fixtures.
4. Add Rust FBO/renderbuffer relations, completeness, storage/deletion/resize semantics and three-path demo execution.
5. Run five workloads through three rotated backend rounds, complete deployment/full regression, update support/architecture/ADRs and publish final evidence.

The common resource bridge is per context. It receives owned define/update payloads, GPU-write version advances and final retirement operations. It resolves texture version references to canonical TextureStorage records for the existing executor. CPU uploads produce new records with ordered copy dependencies. GPU writes advance logical content versions while retaining the rendered GPU allocation. Draws reference stable records and consume no additional texture upload payload. Cores own the GL state and versions.

## Verification

Before each semantic change, map behavior and error precedence to the pinned WebGL/IDL/GLES sources. Add meaningful shared state/error/pixel regressions, including matrix/array packing, i32 precision, bool queries, source views/row alignment, updates/reallocation, NPOT/incomplete textures, multiple units, FBO feedback/attachments, bound/unbound deletion, masks/depth/culling/blending and queue lifetime.

Expand original CTS from seven to eleven files by adding gl-uniformmatrix4fv, gl-uniform-arrays, gl-uniform-bool and gl-get-uniform-non-current-program. Preserve every original assertion and report actual totals. Record texture/FBO CTS readback/CubeMap prerequisites and source-marked asynchronous regressions.

The demo runs at 320x240, DPR1, sequential times 0/1000/2000. Native comparison uses the existing two-byte channel and one-pixel edge-neighborhood tolerance. JS/Rust pixels must match exactly. Save selected core, actual attributes, adapter, shaders, images/differences and hashes. Verify built three-path RTT, triangle and GPU probe.

Local entries include pnpm check, rust:build, rust:test:wasm, compiler:test, test:chrome, build and test:dist. Keep required Actions lightweight and affected-module based. Deliver each accepted PR through ci/required and rebase merge using the existing user identity.

## Performance acceptance

Measure uniform/draw, state changes, dynamic Buffer upload, dynamic texture upload and RTT through native/JS/Rust on one hardware adapter. Use 30 warmup samples, 120 samples, eight logical frames per sample, three rounds with rotated backend order. Prepare input data outside intervals, include conversion/snapshot/bridge/encoding/submission in CPU samples and pace all backends using the same RGBA region outside the timer. Report context initialization, shader/resource setup, first-frame CPU, first completed image, CPU p50/p95 in ms/logical-frame, timer resolution/cache state, GPU timing availability, upload/pipeline/bind-group/pass/copy/submit counts and memory estimates. Preserve raw samples and environment under artifacts.

## Execution record

Baseline checkout and Git identity were verified. No user changes were present. Shared interfaces are frozen before worker implementation and integration owns the five PR boundaries.

### PR1 acceptance

TypeScript passed. The deterministic unit suite passed 75 tests across 12 files, including nine new facade/execution-resource regressions and four JS resource-handle cases. The original complete Chrome suite passed 64 tests in 44.4 seconds against the retained ABI v2 artifact, including the JS render-to-texture demo, shared Buffer/drawing and seven original CTS files. Evidence is in `artifacts/rtt-pr1-type.log`, `artifacts/rtt-pr1-unit.log` and `artifacts/rtt-pr1-chrome.log`.

The four new uniform CTS files are acquired under preparedTests for PR2 activation. Rust ABI v3 development is isolated from the accepted v2 browser artifact during this integration step.

### PR2 compiler dependency correction

The full i32 shared GPU fixture exposed ANGLE emitting `-2147483648i`, whose positive signed literal is rejected by WGSL validation. Preserve the ESSL INT_MIN case and correct the pinned WGSL constant emitter through a recorded idempotent source patch. Add a standalone compiler case and a real pipeline case, rebuild the compiler, then rerun the shared i32 draw and all eleven original CTS files. This bounded correction belongs to PR2's typed uniform acceptance.

### PR2 acceptance

PR #7 rebase-merged the resource contract at 75872b1 after ci/required passed. ABI v3 and typed uniform/raster implementations pass 86 deterministic CPU tests, 30 native Rust tests, TypeScript, formatting/clippy and twelve actual-Wasm tests. Eleven unchanged original CTS files pass 243 assertions on each backend. The four shared uniform/raster scenes, original CTS and compiler GPU test pass six targeted Chrome tests after the INT_MIN source patch. Standalone corpus passes 24 cases and four real shader pairs create GPU pipelines. The patch's second build passes idempotence checking and Ninja reports no work.

PR2 activates four RTT cases in the normal Chrome entry. Texture and framebuffer traces are prepared for activation in their implementation slices. Future draft CPU tests remain outside this PR's source and acceptance. Logs are under `artifacts/rtt-pr2-*`.

### PR3 acceptance

PR #8 rebase-merged the uniform/raster boundary at 60a1783. Texture implementations now pass 99 deterministic CPU tests, 33 native Rust tests and sixteen actual-Wasm tests. The public texture-unit regression exposed missing TEXTURE1 through TEXTURE31 facade constants. Adding the complete constant family preserved the multi-unit test and produced identical expected pixels across all three backends.

The targeted original CTS, profile-selection and fourteen shared uniform/texture/raster scenes pass sixteen Chrome tests. All eleven original CTS files retain 243 assertions per backend. The complete in-scope functional browser regression passes 77 tests in 39.6 seconds, including the existing JS RTT demo. The independent benchmark replacement and Rust FBO/demo activation belong to the following boundaries. Logs are `artifacts/rtt-pr3-{unit,wasm,chrome,regression,type,ci}.log` and `artifacts/rtt/rust-pr3-native.log`.

The accepted Wasm has ABI3/resource protocol1, 261,640 bytes and SHA-256 834c7ce70eb3a42f6475d38fc13fd7dc53e8df44d730bab5f57d1147382b6130. Resource operations carry bounded headers and Rust-owned output pixels copied before arena reuse. PR3 records the resource protocol marker so an older ABI3 build receives explicit rebuild guidance before initialization.

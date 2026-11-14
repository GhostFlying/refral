# Rust typed uniforms, raster, and render-to-texture

Status is complete for Rust implementation and native/actual-Wasm acceptance. Task 020 owns final delivery and performance evidence.

## Ownership and scope

This worker owns native core, Wasm binding, Cargo.lock, the rendering adapter, its integration tests, and this task. The integrating agent owns shared interfaces, facade, host, resource registry, root tools, existing Buffer adapter, and delivery. Follow task 020 and ADR 006.

## Plan and acceptance

1. Complete scalar/vector float, i32, bool, array, matrix, and scalar sampler2D state and packing. Preserve f32/i32 input bits in transport and correct query return types. Audit overflow, excess array counts, null locations, transpose, type errors, and non-current program queries.
2. Implement complete raster state, validation, getters, and owned draw/clear snapshots. Introduce ABI v3 and pass native and actual-Wasm regressions before PR2 handoff.
3. Implement level-zero five-format UNSIGNED_BYTE texture storage, pixel-store state, updates, completeness, sampling and owned binary resource operations in GL order.
4. Implement renderbuffer/FBO references, completeness, feedback checks, target snapshots and post-write content transitions. Verify queued records survive deletion, reallocation and resize.
5. Build candidates under `artifacts/core-wasm-v3/`, record exact results and hand off each PR boundary. The integrating agent advances the default artifact and runs original CTS, Chrome, demo and performance acceptance.

Native and actual-Wasm regressions cover semantic state, packed bytes, resource operation/version ordering, immutable inputs, malformed calls, allocation failures and lifetimes. Use repository checks and preserve existing Buffer and drawing acceptance. Compiler and host fixtures isolate deterministic state tests.

## PR2 handoff

Typed uniforms now store raw 32-bit words in the native executable. Float, i32 and boolean setters follow declared types, queries return scalar numbers/booleans or Float32Array/Int32Array/boolean arrays, and matrix/array packing follows compiler offsets and strides. Vector and matrix array excess is clamped to the remaining elements. Nonarray count greater than one remains INVALID_OPERATION. ArrayStride also identifies declared one-element arrays when the compiler name omits `[0]`. Null setter behavior, location/current program checks, transpose validation and non-current getUniform remain synchronous.

Complete raster state is native and copied into every draw/clear packet. It covers viewport, scissor, color/depth masks, depth test/function/range, blend enable/color/factors/equations, culling and front face. Viewport sizes clamp to the advertised host limit. Blend factors reject SRC_ALPHA_SATURATE in either destination position, and constant-color/constant-alpha conflicts apply to the RGB pair per the pinned WebGL rule.

Private ABI v3 adds binary i32 argument/result tags and boolean-array replies. Draw magic is RFD3, and draw/clear packets carry a fixed complete raster record. Source/name strings remain UTF16 and float data remain unrestricted binary f32/f64. The adapter validates all required exports and uses the same context and instance for Buffer, program, vertex, uniform and raster state.

Validation on 2026-11-14 passed native 30/30, formatting/clippy, TypeScript, and eight actual-Wasm drawing tests. Logs are `artifacts/rtt/rust-pr2-native.log` and `artifacts/rtt/rust-pr2-wasm.log`. The candidate at `artifacts/core-wasm-v3/refral_core.wasm` is 236,263 bytes with SHA-256 `25ed491f88c911302b5e913a0e2550ac5bdd72722c9fa0fff1d9f01e17b653e6`, ABI3 and no host imports. Its build metadata is `artifacts/core-wasm-v3/build.json`. The integrating agent owns the default artifact advance and the four additional original uniform CTS runs.

The candidate test command is `REFRAL_WASM_TEST_PATH=../../../artifacts/core-wasm-v3/refral_core.wasm pnpm --filter @refral/core-wasm exec vitest run --config vitest.wasm.config.ts tests/render.integration.ts`. The override changes only the test's input module. Ordinary verification continues to use the default artifact.

## PR3 handoff

`render/textures.rs` owns typed texture slots, first-bind identity, units, parameters, pixel-store state, image metadata, storage/content versions, completeness and sampling. Level-zero UNSIGNED_BYTE definitions and subimages convert RGBA, RGB, ALPHA, LUMINANCE and LUMINANCE_ALPHA into owned RGBA execution bytes. Conversion honors selected view bytes, row alignment, vertical flip and premultiply. Null definitions initialize zero channels with alpha one for RGB/LUMINANCE. Null subimages report INVALID_VALUE. Incorrect input view types and short data report INVALID_OPERATION. Empty valid updates preserve versions. One-by-one POT images are complete with the default mip filter because their entire mip chain is level zero.

Draw packets carry texture versions and parameter snapshots, and the adapter resolves those versions through the shared ResourceRegistry. Definitions, subimages and final retirement use a binary operation stream before the main reply. The wire supports a separate after stream for the following FBO stage. Shader/source/number replies use the same framed output, with explicit before/main/after lengths.

`rf_resource_protocol_version() === 1` distinguishes this resource wire from the earlier ABI3 uniform/raster artifact. The new adapter verifies the marker before initializing the context and gives rebuild guidance for stale artifacts. Binary resource records carry Rust-owned output pixel pointers and lengths. Those output operations remain owned by the binding until the next command, loss or disposal. The adapter validates each memory range and copies the pixels before returning the GL call. Resource headers are reserved before semantic execution, avoiding a second large Wasm output allocation after a texture state commit. Native conversion and resource queue reservations remain fallible and retain existing state on failure.

Validation passed native 33/33, formatting/clippy, TypeScript and twelve actual-Wasm drawing/resource tests. The new cases cover all five formats and null definitions, offset views and row layout, flip/premultiply, units and NPOT/1x1 completeness, updates/reallocation/deletion, failed update state, and 1 MiB output arenas surviving later command/memory reuse. Malformed pixel descriptors are included in the native transport bounds regression. Logs are `artifacts/rtt/rust-pr3-native.log` and `artifacts/rtt/rust-pr3-wasm.log`.

The PR3 candidate is 261,640 bytes, ABI3/resource protocol 1, SHA-256 `834c7ce70eb3a42f6475d38fc13fd7dc53e8df44d730bab5f57d1147382b6130`, with no host imports. Its module and build metadata are under `artifacts/core-wasm-v3/`. The integrating agent advances the default artifact and records real GPU acceptance.

## PR4 handoff

The native framebuffer module and focused tests were implemented as the bounded task 024, then integrated with the context, resource wire and shared executor. Texture/renderbuffer/framebuffer handles retain independent context/slot/generation identity. FBO bindings and attachments, renderbuffer storage, completeness, queries, deletion, shared retained references and resize generations remain in the native context.

Targets are explicit binary descriptors with default/offscreen identity, dimensions, optional color texture version, and optional renderbuffer handle/storage generation. The adapter resolves these references through the common registry before host encoding. Successful FBO color draws/clears advance the native content version and emit a write-texture operation in the after stream. The bridge applies that alias after encoding, preserving the rendered allocation for subsequent sampling and subimage copies. Pending color-version advances roll back if the main output packet cannot allocate before encoding.

Capture resolves the currently bound native target and synchronizes default canvas dimensions without resetting viewport state. Feedback, undefined attachments, size mismatches, and invalid framebuffer operations are validated before writes. RGBA color texture plus optional DEPTH_COMPONENT16 renderbuffer is the supported FBO profile. Legal depth-only and RGB targets report FRAMEBUFFER_UNSUPPORTED. Initial renderbuffers report RGBA4 and zero dimensions/component sizes. Allocated depth uses the shared depth24plus backing. Current-framebuffer component queries follow attachments and actual default context attributes.

Deleting a texture/renderbuffer clears bindings and the currently bound FBO attachment while unbound FBO references retain its image. Repeated deletion preserves those retained references. Final reference release retires the canonical texture/depth record, while previously encoded operations retain their execution objects. Loss invalidates resource checks, returns the neutral framebuffer status, releases owned arenas/registry state and suppresses flush submission.

The target layout advances `rf_resource_protocol_version()` to 2. The adapter rejects resource protocol 1 before context initialization with rebuild guidance. ABI remains 3. The final candidate is 282,639 bytes with SHA-256 `e407526a05e998a987c90de691d5f679494df7b3ec27b1501693f27815d982ea`, ABI3/protocol2, and no host imports.

Final local acceptance passed native 44/44, actual candidate-Wasm drawing/resource/FBO 16/16, rustfmt/clippy and TypeScript. Native coverage includes output-packet color-write rollback and checked image-byte overflow/OOM with existing storage retained. Actual-Wasm coverage includes post-encoding write alias order, same-allocation sampling, feedback/incompleteness, resize/capture generations, retained deletion, repeated renderbuffer deletion, dynamic component queries, loss and atomic overflow failure. Logs are `artifacts/rtt/rust-pr4-native.log` and `artifacts/rtt/rust-pr4-wasm.log`.

The integrating agent reported full actual-Wasm 20/20, targeted Chrome 23/23, full Chrome 85/85, and packaged RTT/triangle/probe verification passing. The three-path demo at 0/1000/2000 produced zero byte/pixel differences across all nine pair comparisons. Task 020 records the corresponding GPU/environment artifacts, official build manifest, commits and final performance measurements.

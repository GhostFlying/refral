# Rust typed uniforms, raster, and render-to-texture

Status is running.

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

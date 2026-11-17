# CubeMap contract and compiler verification

Implementation and local acceptance are complete on 2026-11-17 as PR1 of task034.

## Plan and ownership

Integration owns packages/core-api, documentation/support and integration. The compiler worker owns packages/compiler/src/index.ts, compiler corpus and existing compiler browser fixtures/tests. A read-only specification audit reviews pinned texture binding/image/completeness/sampler rules before semantic implementation. Browser/GPU execution and Git belong to integration.

Extend TextureVersion with optional imageTarget and level, defaulting legacy references to TEXTURE_2D/0. Registry identity and content transitions include the image subresource. Execution sampling can distinguish 2D and cube views and carry a complete six-face snapshot. Existing 2D callers and data remain usable. GPU-written content retains its allocation and updates its current version metadata. Level-zero CubeMap execution follows in PR2.

Allow scalar samplerCube in compiler linking, retain diagnostics for sampler arrays and other sampler kinds, and verify reflection, binding finalization and WGSL. The real-GPU spike creates a cube texture view and pipeline and validates all six face directions. The compiler spike exposed implicit textureSample in vertex WGSL. Fix this in a pinned ANGLE backend patch so vertex sampling uses explicit base-level sampling, preserve explicit LOD semantics, and rebuild through the existing project wrapper. The compiler worker owns the new patch and package provenance. Integration owns tools/compiler-build.mjs and the actual build.

Record canonical face order +X,-X,+Y,-Y,+Z,-Z and native/host orientation evidence.

Update docs/spec-map.md using the pinned WebGL/IDL, GLES2 texture-object/image/completeness and ESSL100 sampler rules. Record target type fixed by first binding, separate per-unit target bindings, positive square matching cube faces, NPOT/min-filter completeness, mixed sampler-type unit errors and source snapshot/version lifetime. Stage support stays scoped to actual implemented evidence.

## Acceptance

Run pnpm check, focused execution-resource regressions, compiler corpus, headless compiler/cube GPU verification and existing complete110 browser regressions. Actual Wasm and built deployment retain their current accepted profile. Save raw results under artifacts/cubemap/pr1, then deliver through required CI and rebase merge.

## Results

Legacy2D image identity, independent face/level records, cross-image transition rejection and mutable current GPU-write references pass210 CPU tests. TypeScript,58 Rust core tests,8 Wasm-crate tests and38 actual-Wasm tests pass. The compiler corpus passes39 cases. Headless Chrome157.0.8103.79 on apple/metal-3 hardware passes111 complete browser tests. The compiler spike creates four additional real pipelines and verifies32 native/GPU pixel samples with zero mismatches, covering six axes,24 per-face texels and vertex Cube/2D implicit sampling. Existing built probe, three-path RTT/triangles, DOM uploads/readPixels, hashes and module checks pass.

The pinned ANGLE WGSL backend now emits explicit LOD0 for implicit vertex texture sampling. Explicit LOD and fragment implicit/bias cases pass. Sampler arrays, including size-one reflection, and additional sampler kinds retain explicit diagnostics. The original mixed-sampler corpus used the reserved word flat and was corrected to planar before acceptance. All compiler and runtime scope results remain distinguished. Until task036 connects cube execution, the host gives an explicit unsupported diagnostic for CubeMap draws.

Raw commands, source/build metadata and compiler/GPU records live under artifacts/cubemap/pr1. Compiler Wasm SHA256 is5dda1a4dad22fd772807dffbd958555f4f40df2d74116a7bb3841c56437a8657. The ANGLE build applies both WGSL patches idempotently through the existing wrapper. Delivery identifies the PR head, required check, integrated head and main CI in delivery.json.

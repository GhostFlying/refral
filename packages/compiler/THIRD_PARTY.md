# ANGLE compiler provenance

ANGLE revision is pinned in `dependencies.json`. ANGLE is licensed under its included BSD-style license. `ANGLE_LICENSE` preserves the complete notice. Emscripten SDK revision and release are pinned in the same manifest.

The standalone CMake target uses ANGLE's source groups from `src/compiler.gni`, the WGSL output backend, and the common support sources required by the translator. Source manifests are generated into ignored build artifacts.

The following local adaptations apply to the downloaded source build.

- `patches/wasm-mutex.patch` selects ANGLE's existing standard mutex implementation for Emscripten. The upstream Linux platform classification otherwise selects a Linux futex header unavailable in the Wasm sysroot. `tools/compiler-build.mjs` applies and verifies the exact guard replacement.
- CMake force-includes `iostream` for `RewritePipelineVariables.cpp`, which uses `std::cout` and relies on a transitive include in the upstream build.
- `patches/wgsl-integer-minimum.patch` emits the minimum signed i32 constant as a representable WGSL arithmetic expression. The build checks and applies this exact patch idempotently. The source ESSL value and comparison semantics are preserved.

The project linker finalizes ANGLE's documented WGSL location and sampler placeholders using reflected variables. Its initial profile supports scalar/vector/matrix uniforms, scalar Texture2D samplers, and scalar/vector/matrix attribute reflection and column bindings. Struct uniforms, sampler arrays, and attribute arrays return explicit link diagnostics.

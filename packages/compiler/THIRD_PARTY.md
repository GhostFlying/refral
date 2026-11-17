# ANGLE compiler provenance

ANGLE revision is pinned in `dependencies.json`. ANGLE is licensed under its included BSD-style license. `ANGLE_LICENSE` preserves the complete notice. Emscripten SDK revision and release are pinned in the same manifest.

The standalone CMake target uses ANGLE's source groups from `src/compiler.gni`, the WGSL output backend, and the common support sources required by the translator. Source manifests are generated into ignored build artifacts.

The following local adaptations apply to the downloaded source build.

- `patches/wasm-mutex.patch` selects ANGLE's existing standard mutex implementation for Emscripten. The upstream Linux platform classification otherwise selects a Linux futex header unavailable in the Wasm sysroot. `tools/compiler-build.mjs` applies and verifies the exact guard replacement.
- CMake force-includes `iostream` for `RewritePipelineVariables.cpp`, which uses `std::cout` and relies on a transitive include in the upstream build.
- `patches/wgsl-integer-minimum.patch` emits the minimum signed i32 constant as a representable WGSL arithmetic expression. The build checks and applies this exact patch idempotently. The source ESSL value and comparison semantics are preserved.
- `patches/wgsl-vertex-texture.patch` passes the shader stage into the WGSL output traverser and lowers non-shadow implicit vertex texture sampling to `textureSampleLevel` at level zero. Explicit LOD arguments and fragment implicit/bias sampling use their existing paths. The ESSL frontend retains validation of illegal vertex bias overloads.
- `patches/wgsl-frag-data.patch` preserves `gl_FragData` as an array in the private pipeline-output structure and flattens its elements into annotated scalar/vector outputs, copying them after the original shader main returns. The array and element types come from the resource-dependent symbol-table built-in, including its configured length. The current compiler uses ANGLE's default `MaxDrawBuffers = 1`. Original ESSL indexing, control flow and reads remain in the AST. Dual-source fragment outputs retain the upstream unsupported path.

The project linker finalizes ANGLE's documented WGSL location and sampler placeholders using reflected variables. Its initial profile supports scalar/vector/matrix uniforms, scalar Texture2D and CubeMap samplers, and scalar/vector/matrix attribute reflection and column bindings. Struct uniforms, sampler arrays, additional sampler kinds, and attribute arrays return explicit link diagnostics. The pinned reflection reports one-element sampler arrays with scalar size, so linking also diagnoses ANGLE's explicit unsupported texture-operation marker before exposing final WGSL.

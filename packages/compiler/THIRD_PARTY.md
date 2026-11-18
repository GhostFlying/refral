# ANGLE compiler provenance

ANGLE revision is pinned in `dependencies.json`. ANGLE is licensed under its included BSD-style license. `ANGLE_LICENSE` preserves the complete notice. Emscripten SDK revision and release are pinned in the same manifest.

The standalone CMake target uses ANGLE's source groups from `src/compiler.gni`, the WGSL output backend, and the common support sources required by the translator. Source manifests are generated into ignored build artifacts.

The following local adaptations apply to the downloaded source build.

- `patches/wasm-mutex.patch` selects ANGLE's existing standard mutex implementation for Emscripten. The upstream Linux platform classification otherwise selects a Linux futex header unavailable in the Wasm sysroot. `tools/compiler-build.mjs` applies and verifies the exact guard replacement.
- CMake force-includes `iostream` for `RewritePipelineVariables.cpp`, which uses `std::cout` and relies on a transitive include in the upstream build.
- `patches/wgsl-integer-minimum.patch` emits the minimum signed i32 constant as a representable WGSL arithmetic expression. The build checks and applies this exact patch idempotently. The source ESSL value and comparison semantics are preserved.
- `patches/wgsl-vertex-texture.patch` passes the shader stage into the WGSL output traverser and lowers non-shadow implicit vertex texture sampling to `textureSampleLevel` at level zero. Explicit LOD arguments and fragment implicit/bias sampling use their existing paths. The ESSL frontend retains validation of illegal vertex bias overloads.
- `patches/wgsl-frag-data.patch` preserves `gl_FragData` as an array in the private pipeline-output structure and flattens its elements into annotated scalar/vector outputs, copying them after the original shader main returns. The array and element types come from the resource-dependent symbol-table built-in, including its configured length. The current compiler uses ANGLE's default `MaxDrawBuffers = 1`. Original ESSL indexing, control flow and reads remain in the AST. Dual-source fragment outputs retain the upstream unsupported path.

- `patches/wgsl-essl100.patch` supplies the pinned backend with typed helpers for aggregate comparisons, scalar geometric builtins, matrix component multiplication and floating modulo, splats scalar operands at mixed builtin overloads, and reuses ANGLE’s driver-uniform expression for `gl_DepthRange`. Its WGSL helpers take their operands once.

- `patches/wgsl-varying-arrays.patch` lowers ESSL 1.00 scalar, vector and matrix varying arrays to matching scalar/vector WGSL locations in the vertex output and fragment input. The element and matrix-column indices come from the ANGLE AST. A declared array exceeding the configured varying row limit produces a compiler diagnostic before its interface is expanded. The wrapper reflects array shape separately from element count.

- `patches/wgsl-uniform-matrix-field.patch` emits the aligned vec2 wrapper when declaring a matCx2 uniform member, including members retained for storage layout that are never read in that shader stage.

The project linker finalizes ANGLE's documented WGSL location and sampler placeholders using reflected variables. Its initial profile supports scalar/vector/matrix uniforms, scalar Texture2D and CubeMap samplers, and scalar/vector/matrix attribute reflection and column bindings. Numeric structure uniforms retain their declared types for stage matching. A project visitor uses ANGLE’s standard-layout encoder and name traversal to export each addressable field of structure arrays, including basic array and matrix strides. Sampler2D and samplerCube aggregates retain individual logical texture units and physical bindings through ANGLE specialization. Additional sampler kinds and attribute arrays have separate support requirements.

The webgl1-double-underscore patch permits consecutive underscores in identifiers under the WebGL1 language profile. ANGLE keeps the original names in reflection and emits WGSL identifiers in its user namespace.

- `patches/wgsl-point-primitives.patch` maps the ESSL fragment point coordinate into ANGLE's private input and emits separate WebGL1 shader entries for instanced point quads. The vertex entry reads the reserved WebGL1 driver uniform words for viewport size and writes sprite coordinates above the eight advertised varying locations. The normal entries preserve the existing shader path.

- `patches/wgsl-expression-statements.patch` preserves ESSL expression-statement side effects with WGSL discard assignments.

# Enforce WebGL1 stage uniform packing limits

Task 053 identified uniform-vector overflow in the two original WebGL 1.0.4 shader packing pages. Task 059's actual Wasm compiler accepts 90 of 180 generated shader-uniform-packing-restrictions pairs and two of four shader-with-too-many-uniforms pairs whose link is required to fail. Both semantic cores use this compiler.

1. Map WebGL 1.0 packing restrictions and GLSL ES 1.00 Appendix A section 7 to ANGLE's compiler API. Use each stage's configured uniform-vector limit and declared extents of statically used user uniforms.
2. Apply ANGLE's packing algorithm, retain compile diagnostics and report stage-specific packing errors at link, and add actual compiler corpus regressions for stage limits, partial array use, inactive declarations and component sharing.
3. Rebuild with pnpm compiler:build and run pnpm compiler:test, pnpm check and both official pages' generated shader pairs locally. Integration owns their headless native/JS/Rust page runs in the campaign GPU window.

This branch owns the shared compiler wrapper, its corpus, and scoped spec/support documentation. It builds on 059 and keeps the same runtime and compiler profile limits.

## Results

The 060 compiler passes the official generators’ 180 packing pairs and four excess-uniform pairs in Node. The 58-case actual Wasm corpus covers both stages, full declared extents, two vec2 arrays sharing register columns, an unused array, a separately bound sampler, the built-in depth range and a struct array containing numeric array fields. The 059 varying packing generator remains green in all 42 pairs. The shader compiler retains per-stage packing failures until link. The getters and both compiler resource limits still use the existing profile of 128 vertex and 64 fragment rows.

Replaying OGLES CorrectFull_vert.vert reaches a link failure with the present 128-row limit. Its statically referenced uniforms include the predefined mat4 texture-matrix array and arrays of light and material structures. Static use includes references that later optimization can remove. Struct field locations remain a separate task. The seven other pairs link successfully.

The headless integration selector is shader-uniform-packing-restrictions|shader-with-too-many-uniforms|shader-varying-packing-restrictions|build_009_to_016. The immutable validation checkout retains original page results, assertion totals, screenshots, environment and compiler hash under artifacts/conformance/focused. The 060 Wasm SHA-256 is db80921aca6db97e478b33b26d6380b5b701fb8cca0ff482d054cf42b26d08db.

Headless Chrome completed all four original files. The three packing/limit originals passed 181, 5 and 43 assertions on each backend. OGLES completed 17/0 on Chrome and 16/1 on each Refral core. The three compiler browser regressions passed. The immutable run at e1f5c98 and its screenshots are archived in artifacts/conformance/campaign/uniform-packing/official.

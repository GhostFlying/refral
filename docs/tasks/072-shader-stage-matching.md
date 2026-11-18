# Match ESSL 1.00 shader stage interfaces

Tasks 059–071 unblock the shared compiler’s varying, numeric uniform and resource paths. The next residual group is cross-stage declaration matching. Check the pinned GLSL ES §§4.3.5–4.3.6 and 4.6, ANGLE’s original ShaderVariable link comparisons and the original invariance, varying and dEQP linkage cases.

1. Reproduce applicable pairs before implementing. Distinguish declaration, static use, executable stage I/O and invariant qualifications. Check named uniform compatibility across stage declarations.
2. Reflect the required ANGLE metadata and reject mismatched active interfaces. Handle a declared vertex varying whose value is undefined when read by the fragment stage without a vertex write. Preserve a WGSL pipeline with matching typed locations for legal ESSL.
3. Run actual ANGLE compiler cases, pnpm check, headless compiler.spec.ts and the immutable three-backend original selection. Keep point rasterization and sampler-array bindings with their own tasks.

The task owns compiler reflection and shared linkage, corpus and GPU pipeline fixtures and scoped spec/support notes.

## Results

The shared linker now uses ANGLE's static-use and invariance flags separately from active reflection. The physical WGSL vertex interface gains zero-initialized members for active fragment inputs sourced from declared but unwritten vertex outputs. The WGSL type comes from the actual lowered fragment field, preserving matrix columns and array elements. Vertex position invariance is reflected on the WGSL builtin. The point entry can consume the same additional declarations when present.

The 65-case Wasm compiler corpus and pnpm check passed. Original Node pair replays now match all four shaders-with-varyings, both invariant-state-isolation and all 21 mismatching-varying cases. In shaders-with-invariance, the compiled and linked outcomes are correct for 15/18 pairs. The other three require successful compilation of gl_PointCoord and depend on task 073. The actual compiler Wasm SHA-256 is 83b38abc53e3f4829db25bef30395d50fb785f66ab9f7c884d7792fab18c80c7.

Use the immutable browser selector shaders-with-(invariance|varyings|mis-matching-varyings)|invariant-does-not-leak|/shaders/linkage|varying-arrays-should-not-be-reversed. The browser corpus creates a WebGPU pipeline using an unwritten array of matrices and an invariant position output.

## Integration evidence

The three changes reach main in dependency order. With structured reflection, seven structure/location originals passed on both cores. The eighth OGLES file went from 16/1 to 17/0 after the 256-vector vertex limit change. All six capacity originals passed all three paths. The stage matching suite passed six of seven files on each selected core, including 2,272 dEQP linkage assertions per core (2,479 native). The sole remaining file had three original gl_PointCoord dependencies, assigned to task 073. Four headless browser compiler integration tests passed with these changes and the accepted WebGL1 double-underscore adaptation together. The frozen runs and their original page captures are under artifacts/conformance/campaign/structured-uniforms, vertex-uniform-capacity, stage-matching and shader-link-integration.

# Link and address WebGL1 numeric structure uniforms

Build on tasks 059–060 and the shared compiler. Follow GLES 2.0 §2.10.4 and GLSL ES 1.00 §§4.2.4 and 4.3.5 for active basic leaves, arrays within structures, structure array element names, ordered type-definition matching and declared precision. Use the current pinned original shaders and assertions.

1. Compare the pinned translator's typed declarations, uniform block layout, generated WGSL and active program records for numeric structures. Check indexed paths through both semantic cores and instance-specific offsets in both stages.
2. Preserve full types for cross-stage checking. Publish active numeric leaves with their original dotted/bracketed paths, correct independent offsets and array/matrix strides. Keep unsupported opaque aggregate layouts explicit. Verify host-shareable WGSL layout and field type conversions.
3. Add meaningful actual compiler fixtures and exercise the original shaders-with-uniform-structs, shader-with-array-of-structs-uniform, struct-specifiers-in-uniforms, shader-with-array-of-structs-containing-arrays, struct-nesting-under-maximum and uniform-location pages. The upstream gl-uniform-struct-unused file is outside the fixed 1.0.4 list. Recheck the separate OGLES uniform-vector limit.

Owned modules are the compiler wrapper, ANGLE/WGSL adaptations, shared compiler types, participating core uniform lookups, fixtures and scoped docs. Run pnpm compiler:build, pnpm compiler:test, pnpm check, the headless compiler.spec.ts regression and three-backend originals using the campaign GPU lock. Record actual browser outcomes and any separate remaining feature.

## Compiler and page evidence

ANGLE’s initial storage-block visitor exports only element zero of a top-level structure array. The new default-block visitor emits every instance under its qualified GLSL name. A field’s storage location can differ between stages. An outer mat4 in the checked fixture shifts the vertex fields 64 bytes relative to the fragment fields. A two-element array of structures containing a float, mat2 and vec4[2] has an 80-byte element stride and a 160-byte total size. Both semantic cores already consume the linked leaf records and the same Wasm ABI.

The 61-case actual Wasm corpus, TypeScript/native checks and support validator pass. The compiler Wasm SHA-256 is db29f7434ffcf54332ed8271de0657477351cdb63ac6239d41e87390581b69c2. Browser runs use the original scripts for structure field precision and type matching, per-leaf reflection, array updates and pixels. Use the task 053 command with the selector in the immutable checkout’s artifacts/conformance/focused run.

CorrectFull_vert.vert requires 144 vertex uniform rows in a separate probe which runs ANGLE’s packer at increasing capacities. Its static declarations exceed the current profile’s 128 rows. Task 071 covers this resource profile and its runtime limits.

The real Chrome pipeline fixture exposed an additional backend issue. A mat2 field kept for a structure’s layout needs the aligned vec2 wrapper type in each stage, including a stage that reads a different field. Register the float vec2 wrapper when emitting the field declaration, retain the existing read conversions, and check both WGSL wrapper definitions before creating the GPU pipeline.

# Compile ESSL 1.00 varying arrays through the WGSL backend

Task 053 depends on the pinned ANGLE translator, ESSL 1.00 §§4.3.5, 4.3.6 and Appendix A, and the WebGL 1.0.4 official test checkout. Both semantic cores use the same compiler. This task owns the compiler wrapper, translator patches, reflection and location finalization, compiler fixtures, and their specification and support notes.

1. Reproduce the first compiler failure from the original shader-varying-packing-restrictions and OGLES build_009_to_016 pages using their generated or original shader sources.
2. Carry legal scalar, vector and matrix varying arrays across the WGSL vertex/fragment interface. Preserve declared array shape, cross-stage type and extent, and the WebGL profile limits. Map each physical location to its corresponding private array element and column.
3. Exercise positive and negative stage pairs in the actual compiler corpus. Inspect remaining original failures individually and document any independent dependency.

Local acceptance uses pnpm compiler:build, pnpm compiler:test, and pnpm check. Integration runs the headless compiler regression and both original pages through native, JS and Rust/Wasm in the campaign's exclusive GPU window.

## Compiler results

On the unmodified compiler the first required float[1] case failed both stages. Fourteen legal array pairs in the 42-pair official varying packing generator failed. OGLES CorrectFull_vert.vert hit the same translator rejection at its vec4[2] output. Replaying the unchanged generated shader sources with the revised Wasm compiler yields all 42 expected compile/link outcomes. This replay exercises the compiler in Node. The browser runner owns the complete official page verdict, actual assertions, screenshots and selected core.

The first OGLES pair now compiles both stages and reaches the linker's explicit rejection of the active struct-array uniform gtf_FrontLightProduct. The remaining seven OGLES pairs compile and link successfully. Separately, the compiler still accepts over-limit uniform lists: 90 of 180 generated uniform-packing outcomes and 2 of 4 shader-with-too-many-uniforms outcomes differ. The first offending vertex array is bool[129] with a 128-row profile. Uniform limits and struct reflection require separate work.

The build and 50-case actual Wasm corpus passed, including cross-stage locations, matrix element and column indexing, singleton array/scalar mismatch, extent mismatch and an oversized partially used array. The deterministic pnpm check passed. Local compiler artifacts and probe logs live under artifacts/compiler in the implementation worktree. The revised compiler Wasm SHA-256 is dbb08a46c23f9a22e625db6067dea89b4b6258168a42c76b9870faa970ffb7a2.

For integration, run pnpm compiler:build, pnpm compiler:test, the headless tests/chrome/compiler.spec.ts regression, then the task 053 three-backend command with the include expression shader-varying-packing-restrictions|build_009_to_016. The added pipeline fixture uses scalar, vector and matrix arrays in the same program and changes their declaration order between stages.

The headless browser compiler regression passed 3/3. The original varying packing file passed 43 assertions per backend. The original OGLES build group completed with 17 passes on Chrome and 16 passes / one link failure per Refral core. The original pages, screenshots and compiler results at 8a41c77 are in artifacts/conformance/campaign/varying-arrays.

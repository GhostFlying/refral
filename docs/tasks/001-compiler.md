# ANGLE compiler Wasm

Status is complete for the initial host-aligned compiler profile.

## Goal and ownership

Compiler worker owns `packages/compiler`, compiler dependency acquisition metadata/scripts, and compiler corpus. Coordinate shared API with the integrating agent and runtime worker.

## Steps and acceptance

Pin ANGLE and Emscripten, build ESSL-to-WGSL Wasm with CMake/Ninja, expose synchronous compile/link after asynchronous loading, include diagnostics/reflection/layouts, and run ESSL100/300 and link error fixtures. Validate final WGSL in actual browser integration. Record license and patch provenance. Save evidence under `artifacts/compiler`.

## Matrix attribute extension

Extend linker location assignment to reserve consecutive columns for matrix attributes and finalize ANGLE's column markers. Preserve one reflected active attribute with the matrix GL type and base location. Keep the runtime draw guard explicit until matrix vertex input execution is implemented. Add compiler corpus cases for reflection, column binding, overlap and limits, validate generated matrix WGSL in Chrome, and rerun original getter CTS.

## Host-aligned resource profile

Set the shared vertex attribute cap to 8, matching the initial executor's one-buffer-per-attribute path and WebGPU's 8 buffer slots. Rebuild the native compiler constants from the JSON source, test the last legal location and first illegal location, and reject a shader with more active attribute vectors than the profile. Update compiler and support documentation.

## Results

- Built the pinned standalone ANGLE compiler using Emscripten 4.0.23, CMake and Ninja.
- Generated actual browser/Node Wasm and ES module assets, with reflection and documented driver/default/sampler layouts.
- `node tools/compiler-test.mjs` passed 23 compiler and linker cases.
- `pnpm exec playwright test compiler.spec.ts` passed in headed Chrome. Both ESSL100 and ESSL300 linked WGSL compiled without diagnostics and created actual WebGPU render pipelines on the Apple Metal-3 hardware adapter.
- Raw build, Node corpus, browser corpus, and sample program evidence is in `artifacts/compiler`.
- Local portability adaptations and license provenance are documented in the compiler package. ADR 002 records the integration decision, measured samples and initial supported profile.

The final headed Chrome rerun passed all 23 corpus cases and three real WebGPU pipeline creations, including a mat3 vertex attribute. Struct uniforms, sampler arrays, attribute arrays, and varying arrays have explicit initial-profile diagnostics.

The final integrated Chrome run passed 26 tests, including all 23 compiler corpus cases and the original matrix attribute getter CTS. The shared profile uses 8 attribute locations and the compiled Wasm and facade consume that same manifest.

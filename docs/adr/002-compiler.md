# ADR 002 — ANGLE compiler delivered as browser Wasm

Accepted on 2026-11-13.

## Decision

Use ANGLE's ESSL frontend and WGSL translator in a standalone Emscripten module. Load the module asynchronously during context initialization, then expose synchronous shader compilation and program linking. Keep the program linker and reflected binding contract in the compiler package.

The compiler is independent of the production semantic-core language. The browser executor consumes final WGSL and the reflected attribute, per-stage uniform, sampler, and driver layouts.

## Versions and construction

- ANGLE revision `a03f7cbe9746a577b50629b78f10505744a40291`.
- Emscripten SDK `4.0.23`, with emsdk revision `1693ce7359fc9694f198694f902a2cc061239b86`.
- CMake/Ninja wrapper selects the compiler source groups from the pinned upstream `src/compiler.gni` and explicit common support sources.
- Compiler output is `artifacts/compiler/compiler.mjs` and its adjacent `compiler.wasm`.
- The configured initial linear memory is 32 MiB with growth enabled and a 4 MiB stack.
- Dependency provenance, complete ANGLE license, and local packaging adaptations live in the compiler package.

## Interfaces and layout

`createCompiler(baseURL?)` returns a compiler with synchronous `compile(source, stage, version)` and `link(vertex, fragment, attributeLocations)` methods. Results contain success state and logs. Compilation results retain original ESSL, translated WGSL, reflected variables, and uniform offsets.

The project linker validates stage types, language version, active varying interfaces, uniform compatibility, and attribute assignments. It finalizes ANGLE's explicit WGSL location and sampler markers. ESSL parsing, preprocessing, semantic analysis, and translation are performed by ANGLE.

| Resource | Binding contract |
| --- | --- |
| Vertex default uniforms | Group 0, binding 0, vertex-specific reflected offsets |
| Fragment default uniforms | Group 0, binding 1, fragment-specific reflected offsets |
| Samplers and textures | Group 1, alternating sampler `2*i` and texture `2*i+1` |
| Driver uniforms | Group 2, binding 0, 32 bytes |

The driver block contains depth range at byte 0, packed render dimensions at byte 8, packed XY flips at byte 12, miscellaneous state at byte 16, base instance at byte 20, and atomic-counter offsets at byte 24. For the initial bottom-row framebuffer convention, `flipXY = 0x817f7f7f` and `misc = 1 << 20` select the Y correction and GL-to-WebGPU depth conversion. The entry point is `wgslMain`.

## Verified evidence

The standalone Wasm build succeeded on macOS arm64. The observed output sizes were 1,083,781 bytes for Wasm and 14,038 bytes for the JS loader. These sizes describe this build configuration.

`node tools/compiler-test.mjs` passed 23 cases covering ESSL100/300 stages and linking, real compiler errors, varying mismatch, reflected matrix and array layouts, samplers, explicit attributes, binding errors, and prototype-property names. Raw results are saved to `artifacts/compiler/corpus.json`.

The headed Chrome test passed all 23 corpus cases and created actual WebGPU shader modules and asynchronous render pipelines for ESSL100, ESSL300, and a matrix vertex attribute. The Apple Metal-3 adapter reported `isFallbackAdapter = false`. Shader diagnostics were empty. Browser evidence is stored in `artifacts/compiler/chrome-corpus.json`. The test uses a dedicated page and suppresses the development HMR transport to keep concurrent source changes from navigating during compilation.

The Node and Chrome reports retain observed initialization samples for each run. These observations include module loading/initialization and serve as raw measurements for subsequent repeated performance work.

## Initial limits and follow-up

The initial linker supports scalar/vector/matrix attribute reflection and column bindings, scalar/vector/matrix uniforms with per-stage layouts, uniform arrays supported by the translator, scalar Texture2D samplers, and scalar/vector/matrix varyings. It returns link diagnostics for struct uniforms, sampler arrays and other sampler types, attribute arrays, and varying arrays.

Compiler resource limits come from the shared profile manifest and stay consistent with facade-reported limits. The initial attribute cap is 8 locations because the executor uses one vertex buffer per active attribute and the WebGPU device provides 8 buffer slots. The compiler corpus verifies legal location 7, rejected location 8, and excess active attribute rejection at program link. Broader ESSL300 compilation fixtures establish compiler coverage alongside the WebGL1 public runtime profile. The runtime draw profile reports matrix vertex inputs as unsupported until column-wise execution is implemented. Additional builtins, extensions, precision-sensitive behavior, large shader inputs, and complete link conformance remain CTS expansion work.

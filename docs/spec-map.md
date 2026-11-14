# Specification and verification map

## Reference versions

`fixtures.lock.json` fixes the WebGL HTML, IDL, original CTS, and reference tests to commit `39443210f7f81db4773eb104facadfb85d05dfa4`. `node tools/deps-fixtures.mjs` fetches their unmodified bytes into ignored `third_party/cts/` and records the revision and paths in `artifacts/fixtures/manifest.json`.

| Reference | Version and location |
| --- | --- |
| WebGL1 | Editor's draft at the fixed CTS commit, acquired as `third_party/cts/specs/latest/1.0/index.html`. [Pinned HTML](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html) |
| WebGL IDL | Same commit, acquired as `third_party/cts/specs/latest/1.0/webgl.idl`. [Pinned IDL](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/webgl.idl) |
| OpenGL ES | Version 2.0.25, November 2, 2010. Sections 2.10.1–2.10.4 define shader/program and uniform behavior inherited by WebGL. [Specification](https://registry.khronos.org/OpenGL/specs/es/2.0/es_full_spec_2.0.pdf) |
| ESSL | Language version 1.00, revision 17, May 12, 2009. Sections 3.1–3.5 cover source processing, and 4.3.5 covers varyings. [Specification](https://registry.khronos.org/OpenGL/specs/es/2.0/GLSL_ES_Specification_1.00.pdf) |
| Web IDL | Integer conversion, overload resolution, DOMString, and buffer-source conversion algorithms. The WebGL declaration types come from the pinned IDL. [JavaScript binding](https://webidl.spec.whatwg.org/#js-type-mapping) |

The fixed WebGL draft supplies the applicable WebGL differences to GLES. Its current-program rule invalidates drawing immediately after unsuccessful relink. [Pinned difference](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#L4654)

## PR1 behavior mapping

Paths in the verification column identify project test cases or original upstream assertions. Browser fixtures select the native context or shared facade using the same source and inputs. `refral` identifies the JS core in these PR1 artifacts.

| API or condition | Required observation | Specification | Verification |
| --- | --- | --- | --- |
| Failed relink of current program | `LINK_STATUS` false, current wrapper retained, old uniform location and draw produce `INVALID_OPERATION` | WebGL `linkProgram` and `CURRENT_PROGRAM_INVALIDATED`, GLES 2.10.3 | `failed-current-program-relink`, derived from original `program-handling.html::testProgramInvalidation` |
| Earlier draw before failed relink | Orange pixels remain after rejected green draw | WebGL current-program invalidation | `failed-current-program-relink`, full 64×64 orange region |
| Successful relink | Uniform values reset to zero, new location obtained, old location rejected | GLES 2.10.4, printed page 35, PDF page 45 | `successful-relink-reset`, queried zero uniform and red/black/green regions |
| `shaderSource` and `compileShader` | Installed executable and link status remain usable until linking | WebGL `linkProgram`, GLES 2.10.3 | `shader-source-compile-executable`, draws after source replacement, successful compile, and failed compile |
| `detachShader` and `deleteShader` | Linked executable remains drawable | WebGL `linkProgram`, GLES 2.10.3 | `detached-deleted-shader-executable`, original `testProgramShaderRemoval` source |
| `shaderSource` and `getShaderSource` | Preserve DOMString code units | WebGL `CHARACTERS_OUTSIDE_VALID_SET`, pinned IDL `DOMString` | Original `programs/gl-getshadersource.html`, project `shader-source-code-units` with lone surrogates, NUL, supplementary character, and CRLF |
| Buffer target lifetime | Rebinding one object to the other target produces `INVALID_OPERATION` | WebGL Buffer objects and `BUFFER_OBJECT_BINDING` | Original `buffers/buffer-bind-test.html` |
| Buffer overloads and input ownership | Apply pinned IDL conversion and buffer-source rules before semantic validation | Pinned IDL `long long`, `AllowSharedBufferSource`, Web IDL overload/conversion algorithms | Shared Buffer fixtures and facade unit regressions |
| Null uniform location | Null calls produce no GL error with invalid matrix transpose or vector length | WebGL uniform methods, original null-location CTS | Original `uniforms/null-uniform-location.html`, native boundary probe |

The WebGL lifecycle and source clauses above are defined alongside shader/program operations, uniform operations, and source-character handling. [Program clauses](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#L3167), [uniform clauses](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#L3378), [source characters](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#L4294), [buffer clauses](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#L2380)

## Original CTS and derived regressions

The executable original CTS set contains seven files. The harness prepares the JS compiler/device asynchronously, injects the context factory inside an iframe, and executes original scripts and assertions unchanged. Results retain each upstream path, assertion, backend, and fixed revision in `artifacts/cts/results.json`.

- `glsl/misc/shader-with-invalid-identifier.frag.html`
- `glsl/misc/shader-without-precision.frag.html`
- `glsl/misc/shaders-with-mis-matching-varyings.html`
- `uniforms/null-uniform-location.html`
- `programs/gl-get-active-attribute.html`
- `buffers/buffer-bind-test.html`
- `programs/gl-getshadersource.html`

Original `programs/program-handling.html` requires synchronous `readPixels` through `checkCanvas`. The lock records that capability prerequisite under `cts.deferredTests`, and CTS results record `prerequisite-not-run`. Its original invalidation and shader-removal assertions are preserved in the acquired reference file. [Original program test](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/conformance/programs/program-handling.html), [upstream readback helper](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/js/webgl-test-utils.js#L1320)

Project regressions derive state transitions and expected colors from those two original functions. They use deterministic adjacent viewport regions to preserve earlier output and use `getTestingHooks().capture()` for asynchronous JS readback. `program-spec.spec.ts` checks explicit state/error expectations, all pixels in each declared region, and native/JS observation parity. JSON contains shader sources, runtime configuration, adapter information, expected regions, raw pixels, and mismatch counts. PNGs preserve each backend output under `artifacts/program-spec/<case>/`.

## Verified scope

On 2026-11-14, headed Chrome `157.0.8103.51` passed all seven selected original files on native and JS, with 100 assertions per backend. Five project program specification cases passed on both paths. Every expected pixel region had zero mismatched channels and zero maximum difference. The JS WebGPU adapter reported vendor `apple`, architecture `metal-3`, and `isFallbackAdapter: false`. Task 015 records the commands and evidence paths. Rust program/drawing acceptance follows the subsequent shared-contract tasks.

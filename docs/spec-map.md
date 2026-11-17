# Specification and verification map

## CubeMap texture and sampler assertions

Tasks034–037 follow pinned GLES2.0.25 sections2.10.4–5,3.7.1–4,3.7.10–13 and the pinned WebGL texture/query/uniform rules. First successful binding fixes texture target. Each unit independently retains TEXTURE_2D and TEXTURE_CUBE_MAP. Binding/parameter targets use the whole cube, while image APIs use one face. Invalid target types and rejected object rebinding preserve prior state.

Cube face texImage2D definitions require square dimensions. Typed/null0×0 definitions succeed and remain incomplete. Definitions with different face sizes or logical formats succeed individually and make aggregate sampling incomplete. texSubImage2D accepts rectangular regions within its selected defined face. Completeness requires six matching positive square images. Six1×1 faces satisfy the full mip chain even with default mip filtering. Larger level-zero-only cubes need non-mip filtering, and NPOT additionally needs S/T clamp. Incomplete sampling produces opaque black. Active sampler2D and samplerCube using the same unit cause INVALID_OPERATION on drawing and fail program validation. Uniform assignment itself remains valid. [GLES2.0.25](https://registry.khronos.org/OpenGL/specs/es/2.0/es_full_spec_2.0.pdf), [pinned WebGL texture rules](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#L2631), [pinned uniform rules](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#L3378)

Image identity includes the complete handle, imageTarget and level, with independent storage/content versions. Defaulting omitted fields to TEXTURE_2D/0 preserves old records. Define/update/write/retire operations remain within that image. Upload input is consumed before returning, every draw retains the versions and parameters observed at its call, and queued GPU resources outlive GL-visible deletion. ADR009 records the contract. Compiler tests compare six axes and24 off-axis palette texels to explicit GLES cube mapping and native WebGL. [Resource decision](adr/009-texture-image-subresources.md), [pinned array upload original](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/conformance/textures/misc/tex-image-and-sub-image-2d-with-array-buffer-view.html)

Task037 targets the unchanged image_data/canvas/image RGBA UBYTE files. Their original generators execute both2D and cube paths. Complete-file results retain original assertions, shader helpers, asynchronous completion, resource provenance and selected-core evidence. Cube framebuffer attachment acceptance, nonzero levels, mipmap generation and packed types have separate scoped tasks. [ImageData generator](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/js/tests/tex-image-and-sub-image-2d-with-image-data.js), [Canvas generator](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/js/tests/tex-image-and-sub-image-2d-with-canvas.js), [Image generator](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/js/tests/tex-image-and-sub-image-2d-with-image.js)

## Canvas and HTMLImage upload assertions

Task032 extends the same pinned DOM overloads and pixel-store rules to sRGB Canvas/OffscreenCanvas and decoded HTMLImage. Source dimensions, intrinsic brands, CORS/origin-clean checks, return-time consumption, NONE source encoding and current default drawing-buffer selection precede destination mutation. Generic Canvas origin checks use discarded1×1 reads. Destination preflight precedes full capture. A known lost source produces INVALID_OPERATION after source availability checks. Tests retain the native broken-image/bad-target error order separately from the cores' source-first order for that multiple-invalid combination.

Nine public groups retain explicit expected bytes and native/JS/Rust captures. They cover alpha0/1/127/255, flip/PMA, upload/subimage, source mutation and resize, default versus bound FBO, same-context canvas source, source loss, PNG/SVG/srcset sizing, brands/realms, taint/CORS and ICC NONE/default. Browser-default ICC conversion records native policy. The private native image helper verifies actual framebuffer extent, preserving SVG element sizing and raster density behavior. The [DOM extraction ADR](adr/008-dom-image-extraction.md) records source snapshots, dimension probes, source registrations and the accepted runtime dependency.

The headless canvas GL alpha probe observes Canvas2D losing alpha-zero RGB and changing premultiplied low-alpha values. WebGPU external copy plus opaque Canvas2D readback matches the native source transfer. Evidence is in artifacts/dom-input/probes/canvas-gl-alpha.json. Source-context ordering/loss acceptance currently uses same-module Refral sources. Independent realm/module Refral coordination and unregistered native-source loss retain explicit follow-up coverage.

## ImageData DOM upload assertions

Task031 uses the pinned DOM source overloads, TEXTURE_UPLOAD_SIZE, PIXEL_STORAGE_PARAMETERS and WebIDL source union. Six/seven-argument DOM calls convert scalar arguments in order before inspecting a genuine platform source. ImageData dimensions/data come from intrinsic getters, including cross-realm sources and objects with shadowing properties. Detached source data produces INVALID_VALUE. The pure core preflight preserves bindings, storage and versions on failure.

Unorm8 sRGB ImageData supplies tightly packed RGBA independently of UNPACK_ALIGNMENT. Each core applies flip and alpha premultiplication once using the source alpha, then maps to RGBA, RGB, ALPHA, LUMINANCE or LUMINANCE_ALPHA. Pixel consumption completes before the upload returns. Palette, two-draw mutation/update, subimage/reallocation, brand/WebIDL, scalar-side-effect, five-format and loss fixtures compare native/JS/Rust with exact bytes through public synchronous readPixels. Additional ImageData encodings report an explicit profile diagnostic. [Pinned DOM uploads](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#TEXTURE_UPLOAD_SIZE), [pixel storage](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#PIXEL_STORAGE_PARAMETERS)

Canvas and HTMLImage fidelity have separate acceptance in task029. The [Chrome external-image investigation](references/chrome-external-image-alpha.md) records the ICC/cICP control, extra alpha premultiplication and pinned Chromium/Skia source explanation.

## Original state and Buffer CTS expansion

Task030 uses the pinned WebGL/IDL/GLES sources and complete original state/gl-geterror, state/gl-getstring, state/gl-initial-state and buffers/buffer-data-and-buffer-sub-data files. Their assertions cover supported enum/value/operation errors, error draining, required version-string prefixes, initial blend factors, Buffer overload conversion, allocation/update bounds and nullable inputs.

The original getError script permits first-error or multiple-error implementations. Results record its branch and actual assertion count independently. The Buffer script also runs on an isolated page with fixed shared storage exposed, preserving its original optional assertions. Native contexts created on detached helper canvases are captured in environment evidence. Task030 records actual run counts and the headless configuration.

## Public readPixels assertions

Task028 selects the Canvas2D host path for synchronous RGBA/UNSIGNED_BYTE reads. The pinned readPixels clause defines return-time visibility, typed destination compatibility, null/short-buffer errors and current-framebuffer reads. GLES 4.3.1 supplies row order and PACK_ALIGNMENT. The pinned READS_OUTSIDE_FRAMEBUFFER clause leaves corresponding destination bytes untouched, including fully outside rectangles. Row padding and unrelated view bytes are retained. Implementation read format/type getters reject incomplete framebuffers with INVALID_OPERATION. Each semantic core emits the same validated clipped read/packing plan.

Acceptance uses shared public-entry fixtures plus original program-handling, feedback-loop and read-pixels-pack-alignment scripts/assertions. The CTS adapter records iframe-local prototype branding explicitly. [Pinned readPixels](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#L3517), [outside reads](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#L4171)

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

The executable original CTS set is listed in fixtures.lock.json. The first eleven files established shader/program/uniform acceptance. Task037 expands the complete set to21 files. The harness prepares the compiler/device asynchronously, injects the selected context factory inside an iframe, and executes original scripts and assertions unchanged. Results retain each upstream path, assertion, backend, and fixed revision in `artifacts/cts/results.json`.

- `glsl/misc/shader-with-invalid-identifier.frag.html`
- `glsl/misc/shader-without-precision.frag.html`
- `glsl/misc/shaders-with-mis-matching-varyings.html`
- `uniforms/null-uniform-location.html`
- `programs/gl-get-active-attribute.html`
- `buffers/buffer-bind-test.html`
- `programs/gl-getshadersource.html`
- `uniforms/gl-uniformmatrix4fv.html`
- `uniforms/gl-uniform-arrays.html`
- `uniforms/gl-uniform-bool.html`
- `uniforms/gl-get-uniform-non-current-program.html`

Original `programs/program-handling.html` uses synchronous `readPixels` through `checkCanvas`. Task028 activates it in `cts.tests` with the original invalidation and shader-removal assertions and the recorded iframe-realm prototype adapter. [Original program test](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/conformance/programs/program-handling.html), [upstream readback helper](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/js/webgl-test-utils.js#L1320)

Project regressions derive state transitions and expected colors from those two original functions. They use deterministic adjacent viewport regions to preserve earlier output and use `getTestingHooks().capture()` for asynchronous JS readback. `program-spec.spec.ts` checks explicit state/error expectations, all pixels in each declared region, and native/JS observation parity. JSON contains shader sources, runtime configuration, adapter information, expected regions, raw pixels, and mismatch counts. PNGs preserve each backend output under `artifacts/program-spec/<case>/`.

## Verified scope

On 2026-11-14, headed Chrome `157.0.8103.51` passed all seven selected original files on native and JS, with 100 assertions per backend. Five project program specification cases passed on both paths. Every expected pixel region had zero mismatched channels and zero maximum difference. The JS WebGPU adapter reported vendor `apple`, architecture `metal-3`, and `isFallbackAdapter: false`. Task 015 records the commands and evidence paths. Rust program/drawing acceptance follows the subsequent shared-contract tasks.

Task 013 subsequently passed the same seven original files against native, JS and Rust, with 100 assertions per path. Sixteen common drawing scenes passed explicit expected regions and native comparisons with zero maximum byte difference. These include retained deleted shaders/programs and their final retirement. GLES 2.0.25 sections 2.10.1, 2.10.3 and appendix C.1.3 define the retained-name behavior. The final report is [dual-core drawing validation](validation/2026-11-14-dual-core-drawing.md).

Chrome 157 has a recorded query deviation after rejected vertexAttribPointer calls. It can expose the rejected stride/size/type/offset through queries while continuing to render with the earlier valid state. GLES 2.0.25 section 2.5 requires these errors to leave state unchanged. The common fixtures preserve the native observation, assert normative state for JS/Rust, and continue comparing errors and pixels on all three paths. Evidence is under `artifacts/dual-core-drawing/native-attribute-validation.json`.

## Task 020 resource and RTT mapping

Implementation proceeds from these pinned requirements. Task records distinguish implemented and verified progress for each core.

| Behavior | Source and required observation | Verification |
| --- | --- | --- |
| Uniform type and packing | GLES 2.10.4 and WebGL uniform API rules define scalar/vector/array/matrix updates, bool conversion, transpose and length errors. Complete excess array values follow the specified truncation rules. | Four original uniform CTS files and shared typed/packing regressions |
| Typed pixel inputs | Pinned WebGL TEXIMAGE2D requires Uint8Array or Uint8ClampedArray for UNSIGNED_BYTE. IDL view conversion precedes GL validation. | Shared view-kind, offset, fixed SharedArrayBuffer and invalid-source tests |
| Pixel storage | WebGL PIXEL_STORAGE_PARAMETERS and texture upload APIs define alignment, flip and premultiplication. Mutable source bytes are consumed synchronously. | Five-format, row alignment, alpha, zero initialization and source mutation scenes |
| Sampling completeness | GLES 3.7 and WebGL NPOT restrictions define texture completeness and incomplete sampling behavior. Sampler uniforms select texture units. | NPOT/filter/wrap, multiple units and draw-separated update scenes |
| Framebuffer relations | GLES 4.4 and WebGL framebuffer APIs define attachment identities, dimensions, completeness, deletion and storage replacement. | Bound/unbound attachment, resize, deleted references and error-state regressions |
| Feedback | WebGL Feedback Loops Between Textures and the Framebuffer requires INVALID_OPERATION for a sampled rendering feedback loop. | Explicit error and unchanged output checks |
| Raster state | GLES 3.5, 4.1 and WebGL raster APIs define culling, depth, blend, masks, scissor and clear. | Shared state/error queries and deterministic pixel regions |

The resource bridge's define/update/write/retire sequence is an implementation contract for ordered GL behavior. GPU-write versions alias the rendered allocation. CPU subimage updates encode a copy from that allocation before its retirement. This preserves FBO-produced content and earlier encoded operations.

Task 020's uniform slice passed all eleven original files with 243 assertions on each of native, JS and Rust. Texture/FBO original cases retain their synchronous-readback, CubeMap, mipmap, packed-format, copy-image or renderbuffer-format prerequisites in `fixtures.lock.json`. Their asynchronous project scenes retain separate identities and explicit source references.

The pinned texture IDL declares a nullable pixel view for texSubImage2D. A null input reaches semantic validation and produces INVALID_VALUE. Framebuffer attachment queries use GLES 6.1.3 and the WebGL query table. An empty attachment returns NONE for OBJECT_TYPE and INVALID_ENUM for OBJECT_NAME, TEXTURE_LEVEL and CUBE_MAP_FACE. A renderbuffer attachment rejects the latter two texture-specific queries with INVALID_ENUM. Native observations are retained under `artifacts/rtt/native-attachment-queries.json`.

## Complete original DOM texture acceptance

Task037 executes unchanged image_data/canvas/image RGBA UBYTE originals at the pinned revision through native, JS and actual Rust. Per backend they pass226/1570/122 assertions, including2D and six-face CubeMap paths and the exposed OffscreenCanvas branch. The whole21-file set passes2433 assertions per backend. Source provenance, actual-core/context metadata, original messages and resource/Promise/GPU diagnostics are recorded under artifacts/cubemap/pr3/cts. [CubeMap report](validation/2026-11-18-cubemap.md)

## Official runner bootstrap

Task038 executes the pinned original webgl-conformance-tests.html and its own list parser/report scheduler. HTMLCanvas context bootstrap preserves receiver-brand checks, a single contextId DOMString conversion, repeated acquisition and context mode conflicts before calling the already initialized selected factory. Selected-core worker/Offscreen acquisition gaps retain explicit provenance. Original scripts and assertions are served unchanged. Native completion metadata leaves the original context-loss/restoration sequence under test control. [Official runner decision](adr/010-official-conformance-adapter.md)

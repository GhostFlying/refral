# Official WebGL1 conformance baseline

## Scope and reproduction

Task 038 runs the pinned Khronos `webgl-conformance-tests.html` with its original harness, list parser, scheduler and assertions. Conformance version 1.0.4 includes 971 unique HTML entries, with 887 primary files, 53 additional files and 31 GLES2 dEQP files. Native, JS and Rust/Wasm receive the same inventory and official ordering. The installed source contains 5,224 test files plus the license, all verified against Git blobs at `39443210f7f81db4773eb104facadfb85d05dfa4`. [Original runner](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/webgl-conformance-tests.html)

```sh
pnpm conformance:deps
pnpm conformance:run
pnpm conformance:report
```

Results are under `artifacts/conformance/baseline`. The CLI uses installed Chrome in headless mode with one iframe and DPR 1. It rotates browser contexts every 32 files, checkpoints completed URLs and validates the runtime and browser fingerprint before resuming. Each run records the exact launch arguments, both Wasm hashes and the runtime source hashes. Per-file records include context attributes, core selection and adapter data for observed contexts. The runtime base is `main@5b3d8cd`. [Adapter decision](../adr/010-official-conformance-adapter.md)

The exploratory mode ends a Refral file after an uncaught `NotSupportedError` remains unresolved for 100 ms. It records `unsupported`, `capability-error` and the counters observed before termination. The original script remains incomplete. Caught diagnostics and normal completion retain the original sequence. Native uses the original 20-second idle watchdog. Use `--wait-unsupported` to retain that watchdog for every Refral case. The OGLES abs case recorded zero observed assertions and the same non-triangle draw exception under both policies.

## Result interpretation

The denominator is 971 original URLs per backend and 2,913 file/backend runs. Complete collection requires one valid terminal result per URL for each backend. A file pass requires normal original completion and valid selected-core provenance. The adapter reports selected-core OffscreenCanvas WebGL acquisition as unsupported. It flags every worker creation on Refral, including ancillary work, until the runner can verify WebGL context ownership inside workers.

The runner's skipped assertions overlap the raw failure counter. Total observed assertions equal passes plus failures plus assertion timeouts. Effective failed assertions exclude skipped failures. Browser termination can make partial counters unavailable. The result marks this separately from script completion. Each record retains the first 200 original failure messages and the number omitted.

## Full inventory results

Installed Chrome 157.0.8103.79 ran headless on macOS arm64. Native WebGL used ANGLE Metal on Apple M4 Max. Both Refral cores recorded the Apple Metal 3 WebGPU adapter with `isFallbackAdapter=false`.

| Backend | Recorded files | Pass | Assertion fail | Unsupported | Timeout | Execution error | Observed passed assertions | Observed failed assertions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Native WebGL | 971 | 968 | 3 | 0 | 0 | 0 | 269,801 | 4 |
| Refral JS | 971 | 566 | 90 | 207 | 82 | 26 | 204,948 | 8,668 |
| Refral Rust/Wasm | 971 | 571 | 68 | 227 | 79 | 26 | 200,820 | 1,295 |

The report validates all 2,913 results with zero input issues, skips, missing results or core provenance mismatches. All 971 native files, 751 JS files and 737 Rust files reached the original completion callback. The default early termination applied to 138 JS files and 155 Rust files. A further 82 JS files and 79 Rust files reached the idle watchdog. The report retains counters observed before termination. Each Refral backend has 23 files with explicit adapter coverage gaps.

All three backends pass the same 565 files. Six files pass Rust and native with a JS failure. One file, `quickCheckAPI-C.html`, passes JS and native with a Rust failure. The observed assertion totals reflect different advertised limits, conditional branches and early stops. Compare paired original files when evaluating core parity.

| Module | Native passes | JS passes | Rust passes |
| --- | ---: | ---: | ---: |
| GLSL | 315/316 | 271/316 | 272/316 |
| OGLES | 141/141 | 29/141 | 29/141 |
| Textures | 164/164 | 46/164 | 46/164 |
| Rendering | 44/44 | 23/44 | 23/44 |
| Programs | 12/12 | 12/12 | 12/12 |
| Uniforms | 30/30 | 26/30 | 27/30 |
| OffscreenCanvas | 10/12 | 0/12 | 0/12 |

The full module table is in `artifacts/conformance/baseline/summary.md`. The per-backend `results.json` files retain observed assertions and diagnostics. `summary.json` pairs all results by URL, and `failure-clusters.json` adds evidence and dependency patterns.

## Adapter validation

The accepted 21-file set passes through the official page on all three backends with 2,433 assertions per backend. A dedicated current-attribute test passes all 1,241 native assertions and all 633 assertions on each Refral core after returning getter arrays in the test document's realm. Different advertised attribute limits produce different assertion counts. Native context loss remains under original-test control. Evidence from the initial cleanup and realm issues remains in `artifacts/conformance/diagnostics`.

The interruption experiment sent SIGTERM after the first checkpoint, observed exit status 143 and a released Vite port, then resumed from the unchanged checkpoint. Deterministic tests cover source acquisition and repair, exact static responses, context bootstrap, realm handling, termination, result denominators and checkpoint identity.

## Native observations

- `shader-with-double-underscore.html` records two native compile failures. The pinned WebGL specification permits consecutive underscores in shader identifiers. In a control, Chrome compiles the original vertex source with a single underscore and rejects the original name. The pinned fragment fixture also declares an `attribute` in the fragment stage and omits float precision. A controlled fragment shader with a precision qualifier and uniform isolates the same Chrome rejection of the double underscore. [Pinned WebGL rule](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#L4672)
- `offscreencanvas/methods.html` and `methods-worker.html` each reject the enumerable `texElementSubImage2D` method because the pinned helper's allowlist does not include it. The method inventory probe found every expected method in the document and worker. [Pinned API helper](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/js/tests/canvas-tests-utils.js#L329)

The original outcomes remain in the baseline. The controls are recorded in `artifacts/conformance/native-observations.json`.

## Verified failure dependencies

| Dependency | Retained source and runtime evidence | Follow-up scope |
| --- | --- | --- |
| WebGL1 API surface and version detection | The facade synthesizes a function for unknown string members. The pinned wtu.isWebGL2 checks drawArraysInstanced truthiness. Half-float-linear and format-filterable-renderable enter WebGL2-specific branches | Declare the WebGL1 member surface and preserve undefined for absent interfaces, then rerun affected helpers/directories |
| Enabled attribute validation | gl-enable-vertex-attrib expects INVALID_OPERATION for an enabled unconsumed attribute without a buffer. Draw currently validates active program inputs | Apply the pinned enabled-array rule while retaining the allowed unconsumed short-buffer behavior |
| Core validation parity | Native and Rust pass six originals that fail JS, including attribute and uniform name validation, uninitialized renderbuffer attachment and texture argument validation. Native and JS pass `quickCheckAPI-C` while Rust fails its valid-argument assertion | Add shared spec-derived checks and rerun the seven originals |
| Vertex formats and primitive modes | Both cores report non-triangle draw diagnostics in the same 129 files. The OGLES helper draws a quad with `TRIANGLE_STRIP`, and 111 of its 141 files report an unsupported mode. GLSL function tests also reach non-FLOAT attribute inputs | Add the required WebGL1 attribute formats and primitive modes through the shared execution contract |
| WGSL backend lowering | Twelve files per core record WGSL parser or validation errors with the same URL set. Source-reviewed examples cover vector-component addresses, logical expression statements, scalar/vector builtin overloads, scalar faceforward/reflect and struct equality | Add direct compiler/GPU corpus cases and pinned native backend adaptations |
| Compiler robustness | long-expressions-should-not-crash reports a compiler-Wasm call-stack RangeError | Audit standalone build stack limits and the specific translation traversal |
| Canvas attributes and presentation | Preserve requests are ignored by the current attribute profile. Direct Canvas2D drawImage/toDataURL observes content before deferred presentation | Define requested drawing-buffer lifetime and synchronous consumer behavior through an execution/presentation decision |
| Drawing-buffer dimensions | Raw canvas dimensions can exceed the device limit, and zero-sized surfaces produce mismatched drawing-buffer queries and GPU validation errors | Validate/clamp logical drawing-buffer size and the concrete presentation allocation path |
| ImageBitmap and video | ImageBitmap originals reach the facade's unsupported source-brand path. Eight video files per core time out after `Illegal invocation`. The JS repro captures the error at the original `gl.unpackColorSpace` assignment. The adapter-installed native prototype exposes that property, whose setter requires a browser-branded context | Correct the adapter's optional-property exposure, rerun the video originals and then implement the new DOM source paths |
| Formats, mipmaps and attachments | Rust explicitly reports packed pixel types as unsupported. JS rejects those types through GL errors or yields pixel mismatches in the same originals. Other files retain mip, copy, renderbuffer and cube-attachment blockers | Implement packed `UNSIGNED_SHORT` formats with typed and DOM sources, then use the dependent texture, copy and attachment groups to order mip and FBO work |

The machine report contains overlapping evidence-pattern clusters and examples. The table records source-reviewed dependencies. Complete-file pass counts, original failures and first capability barriers determine subsequent bounded tasks.

The targeted video stack is recorded in `artifacts/conformance/video-observation.json`.

## Implementation order

1. Correct the WebGL1 facade surface and the adapter's optional-property exposure. Add specification-derived cases for absent WebGL2 members and supported properties. Rerun the named extension, texture and precision-format originals and investigate the seven files where JS and Rust disagree on pass status.
2. Add `TRIANGLE_STRIP` and the WebGL1 vertex attribute formats used by the OGLES and GLSL fixtures. Cover `drawArrays`, `drawElements`, array bounds, normalization and all enabled arrays against the pinned rules. Rerun every affected original file after each shared contract change.
3. Validate the retained native-valid shader cases as standalone ANGLE and WebGPU fixtures. Fix WGSL lowering independently of geometry coverage, and rerun the original GLSL groups with the fixed compiler builds.
4. Implement the three packed pixel types for typed and DOM sources. The texture groups can then measure mipmap completeness, copy and framebuffer format work without the initial type rejection. Track video, ImageBitmap, synchronous Canvas consumers and OffscreenCanvas or worker contexts as separate dependencies.

## Delivery

The Playwright launch-server driver stalled on browser teardown after checkpointing JS and again after checkpointing Rust. Rust ran separately with the same runtime fingerprint. The delivered driver uses the direct Chrome connection and bounded teardown. A 12-file run per backend verified transitions, result parity with the recorded baseline and SIGTERM resume. The full baseline retains its original driver hash and launch history. [Task and teardown evidence](../tasks/038-official-conformance-baseline.md)

Local verification passed 226 JS unit tests, 57 conformance tool tests, 75 native Rust tests, 46 actual-Wasm tests and 45 ANGLE cases. All 122 headless Chrome regressions passed. The built browser verification passed with matching packaged Wasm hashes. Required Actions retain deterministic checks. The full hardware run uses the independent local command.

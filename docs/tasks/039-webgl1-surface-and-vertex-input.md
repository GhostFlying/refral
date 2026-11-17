# WebGL1 API surface and vertex input

## Scope

Follow task 038's first two implementation steps. Declare the shared WebGL1 member surface and isolate CTS realm branding from native accessors. Add triangle strips and all five WebGL1 vertex array component types across JS and Rust/Wasm. Verify actual rendering and compare targeted original-file outcomes with the task 038 baseline.

Dependencies are the pinned WebGL1/IDL, GLES 2.0.25, the shared draw contract, the current Rust WASM ABI and both CTS entry points. Shader lowering, other primitive modes and additional DOM upload types retain their own follow-up scope.

## Implementation

1. Use the pinned IDL core operations and constants for facade member detection. Keep valid core entry points callable with explicit capability diagnostics. Keep absent WebGL2 and unimplemented optional attributes undefined. Preserve facade expando and method identity behavior. Update the two CTS adapters so iframe branding cannot install native accessors on a facade context.
2. Store type, normalization, stride and byte offset in each core. Validate per-type alignment and the range of active attribute fetches. Validate buffer presence for all enabled arrays. Preserve the spec's allowance for unused bound arrays with short storage.
3. Carry primitive and component type information in owned draw snapshots. Advance the Rust ABI and check its version before creating the selected core. Convert integer attributes using the existing shared float repacking path. Use WebGPU triangle-strip pipelines and widen 16-bit strip indices to preserve WebGL1 index 65535. Key caches by all attributes that change the resulting bytes or pipeline.
4. Run deterministic and actual-Wasm tests, shared headless pixel and error cases, the affected official CTS files, full Chrome regressions, and deployment checks. Update support metadata and deliver through required CI and rebase merge.

## Ownership and evidence

The integrating agent owns the facade, both cores, execution contract, Rust wire changes, browser host, shared fixtures and docs. Original files remain at the pinned revision. Use `pnpm check`, `pnpm rust:build`, `pnpm rust:test:wasm`, `pnpm test:drawing`, `pnpm test:chrome`, `pnpm build`, `pnpm test:dist` and targeted `pnpm conformance:run` invocations in an isolated Chrome profile with headless mode. Store results under `artifacts/vertex-input`.

## Targeted official results

The surface checkpoint ran 21 original files per backend on headless Chrome 158.0.8127.36 with the previous ABI3 Wasm and the corrected facade. It used a 3-second idle watchdog. Native outcomes are unchanged. Both Refral cores pass the original float-linear and half-float-linear extension files. Format-filterable-renderable reaches its WebGL1 draw path. All eight video files per core reach the DOM-source check and time out with a `TypeError` for the unsupported source, replacing the previous native `unpackColorSpace` setter error. Evidence is in `artifacts/vertex-input/surface-cts`. Both extension files also pass on the ABI4 build using the standard 20-second watchdog, recorded in `surface-final`.

The geometry run uses ABI4, the official 20-second idle watchdog and the default capability-termination policy. It selects all OGLES and attribute files plus every baseline file whose observed errors or assertion messages included non-triangle drawing or non-FLOAT vertex input. The exact 187-file set is in `artifacts/vertex-input/geometry-files.json`. Native, JS and actual Rust/Wasm ran the same files. Refral used the Apple Metal 3 hardware adapter. The original task 038 uses Chrome 157.0.8103.79. A separate control rebuilt the ABI3 core and ran the same 187 files from main at ce0566a on Chrome 158.0.8127.36. The control uses the same installed browser and 20-second watchdog as the geometry run. The rebuilt ABI3 Wasm matches task 038’s Wasm hash. The status totals below use the Chrome 158 control, saved in `artifacts/vertex-input/geometry-control`.

| Backend | Baseline pass | Current pass | Assertion fail | Unsupported | Timeout | Execution error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Native | 187 | 187 | 0 | 0 | 0 | 0 |
| JS | 40 | 156 | 4 | 13 | 1 | 13 |
| Rust/Wasm | 41 | 157 | 3 | 13 | 1 | 13 |

Both cores gain 116 passing files in this selection and retain all their earlier passes. OGLES moves from 29/141 to 127/141 on each core. The three unchanged originals gl-enable-vertex-attrib, gl-vertexattribpointer and gl-vertexattribpointer-offsets pass 15, 2,904 and 406 assertions per backend, respectively. The remaining 14 OGLES files include 12 WGSL errors, one pixel failure in mod and one timeout in build. WGSL diagnostics name unresolved gl_DepthRange_, unresolved TODO_Operator calls and mixed vector/scalar clamp argument types. `artifacts/vertex-input/geometry-summary.json` and `geometry-cts/{native,js,rust}/results.json` retain paired outcomes.

## Drawing and browser observations

Three additional headless scenes cover strip winding under culling, nonzero first/index offsets, the upper ushort index, per-type alignment, signed and unsigned normalization, default component fill and enabled arrays with missing or short storage. Both Refral cores match the explicit expected pixels across all scenes. Native and Refral match in the ordinary strip regions. For the last band of the index-65535 scene, Chrome WebGL1 renders 512 of 1,024 expected yellow pixels with no GL error. The observation is consistent with treating 65535 as restart. The fixture retains all native pixels and limits the native comparison to the first 48 columns, while both cores must match all 64 columns against the WebGL1 expectation. [WebGL2 primitive restart difference](https://registry.khronos.org/webgl/specs/latest/2.0/#PRIMITIVE_RESTART_FIXED_INDEX)

The compiled ABI4 module uses resource3, readback1 and DOM upload2. Its build metadata and SHA-256 are in `artifacts/core-wasm/build.json`. The selected artifact has no host imports. The host widens only the ushort strip span that references index 65535. The vertex conversion uses the existing float repacking path, with type and normalization included in its cache key. [Draw contract decision](../adr/011-vertex-input-and-topology.md)

## Remaining validation differences

The probe captures the legacy tests' detailed failure DOM under `artifacts/vertex-input/legacy-case-detail.json`. Rust's quickCheckAPI-C fails on the unsupported clearStencil operation. JS texImage2DBadArgs and texSubImage2DBadArgs report INVALID_ENUM for packed-type combinations where the original asserts INVALID_OPERATION. The name-length and character rules for JS attribute and uniform lookups, and JS attachment validation for an uninitialized renderbuffer on COLOR_ATTACHMENT0, remain observable in the original results.

## Local acceptance

`pnpm check` passes TypeScript, 226 JS unit tests, 58 tool tests and 75 Rust native tests. The actual ABI4 Wasm passes 47 adapter tests. `pnpm test:drawing` passes 22 cases and `pnpm test:chrome` passes 125 cases, all headless. The built deployment check verifies RTT, triangle, readPixels, DOM and CubeMap output plus the packaged ABI4/resource3/readback1/DOM2 artifact. Logs are under `artifacts/vertex-input`.

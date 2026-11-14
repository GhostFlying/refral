# Dual-core drawing verification

Implementation and final integration verification are complete.

## Goal and ownership

Complete the shared verification and minimal example for task 013's final drawing stage. This task owns the CTS runner and Chrome entry, new shared drawing fixtures and Chrome suite, `examples/triangle/`, and this record. The integrating agent owns public context construction, shared contracts, Vite/build inputs, deployment verification, and support reporting.

## Plan

1. Extend CTS context preparation and result recording to native, JS and Rust while preserving original assertions and the existing JS alias.
2. Define identical ESSL100 shader sources, API traces, explicit state/error assertions, pixel regions, and tolerances for all three backends.
3. Cover float scalar/vector uniforms and vertex input, arrays and indexed triangles, ordered updates and snapshots, allocation/deletion/resize, and automatic/explicit submission. Reuse compatible program lifecycle cases through shared inputs.
4. Add a minimal triangle example selecting `native`, `js`, or `rust` through the URL and reporting its selected backend and outcome.
5. Run CPU/type checks and coordinate an exclusive Chrome window with the integrating agent. Save each backend's environment, shaders, configuration, assertions, pixels, PNGs and failure differences. Record all unsupported capabilities or failures.

## Acceptance

All seven fixed original CTS files execute unchanged for native, JS and Rust with per-backend records. Shared drawing scenes pass explicit state/error and pixel expectations through each backend's selected implementation. The example renders with native, JS and Rust. Existing JS drawing acceptance is preserved by the integrating agent's complete regression run. Runtime and deployment checks remain pending until their actual execution.

## Implemented verification

- The CTS runner accepts `native`, `js`, and `rust`, with `refral` retained as a JS alias. It asynchronously prepares the selected core before running unchanged original scripts inside the synchronous context factory. Each result records the requested backend, observed hook core, environment, original assertions, errors, and adapter changes.
- The CTS Chrome entry executes all seven selected files on each backend, requires 100 passing assertions per backend, records initialization failures, and retains `results[].refral` for existing report readers.
- Sixteen shared drawing scenes cover all eight float scalar/vector uniform setters, indexed triangles with u8/u16 uploads and updates, caller-view snapshots, FLOAT stride/offset, constant attributes, buffer replacement/deletion, canvas and attribute size changes, viewport/clear coordinates, invalid draws, automatic task/rAF submission, explicit flush, program lifecycle, and source code units.
- Scene results include explicit state/error checks, intended pixel regions, raw pixels, shader sources, actual adapter/context configuration, host counters, browser version, and Rust/compiler Wasm SHA-256 values. Each backend receives a PNG. Failed expectations also receive expected/native difference images. Every Refral context verifies its selected hook core.
- `examples/triangle/index.html?core=native|js|rust` draws a colored triangle with interleaved position/color input. Its status is `<core> · rendered`; `window.refralTriangle` records the selected backend and readiness for deployment verification. The integrating agent owns the Vite input and built-entry checks.

## Local validation

On 2026-11-14, `pnpm typecheck` passed. Test collection and `git diff --check` passed.

The first exclusive Chrome run passed 18 of 19 tests. Every intended image region passed. One native stride query differed after an invalid attribute-pointer call, as recorded below.

After documenting that native query behavior and preserving the normative JS/Rust check, `pnpm typecheck && pnpm exec playwright test dual-core-drawing.spec.ts cts.spec.ts` passed all 19 tests in 8.0 seconds on headed Chrome `157.0.8103.51`. This run covered 15 drawing scenes through all three backends, three example entries, and all seven original CTS files. Native, JS, and Rust each passed 100 original assertions. Evidence is under `artifacts/dual-core-drawing/` and `artifacts/cts/results.json`.

The tested Rust Wasm SHA-256 was `d5ddc79d1bccec2cac38e7bd19be228b888a7c1e5d7522b01f2f53515fb7553b`. The compiler Wasm SHA-256 was `f6e6c07afc47f37b543a36444f3438b7aa8e137219d1a052b30b9df0cff85118`. The adapter reports `vendor: apple`, `architecture: metal-3`, and `isFallbackAdapter: false` in the per-scene records.

The integrating agent subsequently requested the sixteenth scene, `retained-deletion-and-retirement`, using the measured native behavior below. It covers marked-deleted objects retained by attachment/current-program use, permitted source/compile/relink/query operations, rejected re-selection, and final retirement errors. Its implementation passes TypeScript checking and the complete entry now collects 20 tests. The integrating agent's final Chrome run covers this added scene after the matching semantic fixes and Wasm rebuild.

## Native attribute-query deviation

Chrome `157.0.8103.51` returns `INVALID_OPERATION` for a FLOAT stride of 3, then reports stride 3 from `getVertexAttrib`, while the rendered output uses the previously valid state. The independent probe also observed query changes after negative stride, size 5, invalid type, and unaligned offset. `artifacts/dual-core-drawing/native-attribute-validation.json` records before/after state and exact errors.

GLES 2.0.25 section 2.5 requires these erroneous calls to leave GL state unchanged. The shared scene retains the native query as `observations.rejectedAttributePointer`, asserts unchanged stride for JS and Rust, and asserts native GL errors and intended pixels. The API trace remains the same for all three backends. [GLES error rules, printed page 14](https://registry.khronos.org/OpenGL/specs/es/2.0/es_full_spec_2.0.pdf#page=24)

## Native retained-deletion probe

`artifacts/dual-core-drawing/native-retained-deletion.json` records a headed native Chrome probe requested by the semantic owners. A deleted attached shader remains live, accepts source/compile operations, and reports its deletion flag. A deleted current program remains live and accepts relinking and fresh uniform/attribute queries. Re-selection through `useProgram` produces `INVALID_OPERATION`, while its existing current draw remains usable. A deleted shader detached from its final program and a deleted program released by `useProgram(null)` retire; their parameter queries return null with `INVALID_VALUE`. Re-linking stales previous uniform locations and resets fresh uniform values to zero.

The exact results were sent to both the integrating agent and JS semantic owner. The shared retained-deletion scene follows those observed transitions.

## Handoff

The exclusive GPU window has been released. Final complete Chrome regression, the added retained-deletion scene, deployment verification, support reporting, and delivery are owned by the integrating agent. This worker performed no Git operation. Ownership of this task record transfers to the integrating agent for final results.

## Final integration acceptance

The integrating agent's final headed Chrome run passed all 64 tests in 41.9 seconds. This includes all 16 shared scenes, the retained-deletion scene, three examples, the seven original CTS files and all existing JS/compiler/Buffer/loss regressions. Every shared image comparison had zero byte difference. Rust Wasm SHA-256 was 171c1248cb9e8a8ea67425c1344de49110d54f92fcc6b9c132bd7c23d4d6c964 after the final lifetime audit.

The standalone build and deployment check passed actual native/JS/Rust triangle rendering, packaged ABI v2, the JS render-to-texture demo and the WebGPU probe. The final report is [dual-core drawing validation](../validation/2026-11-14-dual-core-drawing.md). Task 013 records PR integration and exact delivery status.

# Spec-driven dual-core drawing

Status is running.

## Goal and ownership

Implement the approved next-stage plan through four atomic PRs. The integrating agent owns shared contracts, facade integration, compiler coordination, support reporting, and delivery. Bounded workers own JS semantics, Rust semantics/binding, and shared verification. Each file has one write owner at a time.

The public factory remains `createWebGLOnWebGPU(canvas, { version: 1, core })`, with JS as default. This stage covers ESSL100 shader/program lifecycle and reflection, FLOAT attributes, float scalar/vector uniforms, triangle arrays and u8/u16 indices, default framebuffer clear/viewport, ordered snapshots, automatic submission, and asynchronous testing capture.

## PR sequence

1. Establish pinned spec references and API assertions, correct JS relink behavior and Buffer conversion deviations, and add the two selected CTS files.
2. Move host-neutral execution and compiler data types into core-api, decouple browser-host from core-js, and preserve existing JS rendering.
3. Introduce typed shader/program/location handles, shared synchronous compiler coordination, Rust program state and ABI v2, and both-core CTS preparation.
4. Complete Rust vertex/uniform/draw snapshots, common execution/capture, three-path scenes, a minimal example, and deployment validation.

## Required behavior

- Spec references use the WebGL/IDL source at CTS revision 39443210f7f81db4773eb104facadfb85d05dfa4, applicable GLES 2.0.25, ESSL100, and WebIDL conversions.
- Both cores own their GL state, validation, errors, lifetime and versions. Compiler artifacts and GPU objects use shared services and explicit lifetime ownership.
- Failed relink invalidates drawing with the current program. Source/compile changes alone preserve the installed executable until linking.
- Uniform locations include program identity and link generation. Successful relink resets values and invalidates old locations.
- Draws preserve buffer/uniform versions observed at call time. Mutable inputs are consumed before return.
- Shader source preserves DOMString code units. Wasm metadata uses bounded cold-path JSON with pinned binding-only serde dependencies. Draw data uses owned binary snapshots.

## Acceptance

Run meaningful CPU/native regressions through the lightweight required CI. Run actual Wasm, compiler corpus, real Chrome differential scenes, selected original CTS, and deployment checks through local or optional entry points. Preserve the existing Buffer, JS differential and demo regressions. The final selected CTS set is the existing five plus buffer-bind-test.html and gl-getshadersource.html, executed unchanged against native, JS and Rust.

Save per-core state, pixels, shader/configuration, and failure artifacts. Record spec/CTS mappings, support limits, ABI changes and actual run results. Deliver each PR using the existing user identity and rebase merge, then verify main.

## Execution record

Implementation has started from main at 2c31e1c. Worker scopes and intermediate results are recorded below as work progresses.

### PR1 local acceptance

On 2026-11-14, TypeScript checking passed and 43 deterministic JS tests passed. The complete headed Chrome run passed 45 tests in 38.5 seconds. Seven unchanged CTS files passed 100 assertions each on native WebGL and JS. The five new program scenes passed explicit state/error assertions and image regions, with exact native/JS pixel agreement. Buffer conversion checks passed on native, JS, and actual Rust Wasm, including fixed shared input snapshots and resizable-buffer rejection. Evidence is under `artifacts/spec-semantics-full-chrome.log`, `artifacts/program-spec/`, `artifacts/buffers/sources.json`, and `artifacts/cts/results.json`.

Rust shader/program and drawing acceptance remains assigned to PR3 and PR4. The original program-handling CTS file is acquired and tracked with its synchronous readPixels prerequisite. Its asynchronous project-derived regressions are identified separately in the specification map.

### Contract integration

PR #3 was rebase-merged at dc3f003 after ci/required passed. PR #4 moved compiler and execution data into core-api and was rebase-merged at 2c848c3 after its required check. Its separate complete Chrome run passed 45 tests in 35.4 seconds, with evidence in `artifacts/host-contracts-chrome.log`.

### Unified-core implementation

PR3 introduces typed object handles, per-context compiler artifact ownership, the shared DrawingCore, facade conversion/wrapping, and the Rust ABI v2 implementation. Rust Buffer and drawing operations use one context. Native drawing records landed alongside shader/program transport so the versioned ABI has a coherent implementation. PR4 completes three-path drawing acceptance, runnable examples, deployment and final support reporting.

Local implementation checks pass TypeScript, 62 JS unit tests, Rust formatting/clippy and the native Rust suite. The actual-Wasm entry now runs nine tests across Buffer and drawing transport. Seven unchanged CTS files passed 100 assertions on each of native, JS and Rust. The existing 45-test Chrome suite passed after public DrawingCore integration. Raw records are `artifacts/program-cores-check.log`, `artifacts/program-cores-wasm.log`, `artifacts/program-cores-full-chrome.log` and `artifacts/cts/results.json`.

The lifecycle audit additionally verifies retained deleted shaders/programs, rejects rebinding a deleted program, and reports INVALID_VALUE after final shader/program retirement. The native probe is preserved in `artifacts/dual-core-drawing/native-retained-deletion.json`. Final three-path scenes and built deployment remain under PR4 acceptance.

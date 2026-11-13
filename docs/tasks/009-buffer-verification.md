# Shared Buffer verification

Status is complete for the common Buffer milestone on 2026-11-13.

## Goal and ownership

The verification agent owns shared fixtures under `tests/core`, the Chrome Buffer suite, and this task record. The integrating agent owns the facade, build aliases, command entry points, and support metadata.

## Steps

1. Confirm native WebGL behavior for Buffer boundary cases used by the fixtures.
2. Exercise identical public Buffer calls through native WebGL, JS core, and Rust/Wasm core.
3. Compare observable state/errors and the JS/Rust diagnostic byte/version snapshots.
4. Add direct shared-core checks for generational handles and diagnostic ownership where the public facade cannot observe them.
5. Save results by core and report integration failures to their owners.

## Acceptance

Common Chrome fixtures cover object identity before/after binding, allocation, view offsets and caller mutation, subrange updates, invalid operations, cross-context objects, deletion, errors, and context loss. JS/Rust snapshots agree on bytes and resource-version transitions. Each selected path is identified in saved evidence. Direct handle checks cover stale generation reuse and inspection preserving existing error flags.

## Implementation

- `tests/core/buffer-fixtures.ts` states public WebGL behavior once. Native uses GL queries and identity/error observations. The two Refral paths additionally verify copied byte snapshots and storage/content versions. Native WebGL1 does not expose a buffer readback query; these byte snapshots are recorded as JS/Rust evidence rather than native byte readback.
- `tests/core/buffer-contract.ts` exercises the same logical-handle fixture against either core, including stale slot reuse, allocation limits, inspection ownership, foreign handles, and context loss. The Node unit test uses the real JS semantic context with a host that rejects rendering or shader work. The Chrome tests use the actual Rust Wasm adapter.
- `tests/core/buffer-browser.ts` supplies native, JS, and Rust context construction and cleanup. `tests/chrome/buffers.spec.ts` saves each backend result before asserting parity and records the actual Chrome version and context environment.

## Validation record

- Native-only boundary probes ran in headed Chrome `157.0.8103.51`. Raw results: `artifacts/buffers/native-probe.json` and `artifacts/buffers/native-numeric-probe.json`.
- Native `bufferData(null)` produces `INVALID_VALUE` and retains storage. `bufferSubData(null)` throws `TypeError` without a GL error. An empty view at the storage end succeeds; beyond the end it produces `INVALID_VALUE`.
- Native numeric size `1.5` becomes `1`; `-0.5`, `NaN`, and `Infinity` become `0`. Numeric offsets `1.5` and `NaN` are accepted after conversion to `1` and `0`. Fixtures verify those offsets through JS/Rust snapshots.
- Native binding checks reject foreign or deleted objects before validating the target enum. Usage validation precedes a negative allocation size. Probe results were sent to both core owners and the integrating agent.
- `pnpm exec vitest run tests/core/buffer-contract.test.ts`: one shared JS contract test passed. It exercises 36 named assertions against the actual JS core adapter, without browser/GPU work.
- Initial `pnpm test:buffers --list` collected seven Chrome tests. The integrating agent subsequently ran them with the real Rust module and common facade; final results are recorded below.
- The first `pnpm typecheck` found missing in-progress `@refral/core-wasm` exports and two local implicit callback types. The local callback types were corrected. A second check reports only the missing Rust adapter module, which is rechecked during integration.

## Context-loss correction

The integrating agent's first Chrome run passed six of seven tests. The native loss case exposed an outdated expectation in the fixture: native Chrome returned a `WebGLBuffer` from `createBuffer()` while lost, whereas the fixture expected null.

This is the current specified behavior. The [latest WebGL1 specification](https://registry.khronos.org/webgl/specs/latest/1.0/#CONTEXT_LOST) defines objects created during context loss as invalidated, and `createBuffer()` has a nonnullable return type. At the repository's pinned CTS revision `39443210f7f81db4773eb104facadfb85d05dfa4`, [`conformance/context/context-lost.html`](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/conformance/context/context-lost.html#L318) checks that Buffer creation returns an object and that `isBuffer` stays false both before and after binding. This test file was read for reference; it is not part of the initial selected CTS run.

A separate headed Chrome `157.0.8103.51` probe reproduced fresh invalidated wrappers, extensibility, caller properties, inert binding/upload/deletion, null binding queries, and `NO_ERROR` after the loss error is consumed. Passing such a wrapper into another active context produces `INVALID_OPERATION`. Results are saved in `artifacts/buffers/native-loss-probe.json`. Native Buffer wrappers are also extensible before loss. The shared fixture now requires these public creation and property behaviors across all three backends.

The internal `BufferCore.createBuffer()` loss result remains null and allocates no logical resource. The public facade creates a fresh invalidated wrapper instead. This preserves the distinction between internal resource allocation and the public WebGL object behavior. The fixture does not accept multiple backend-dependent outcomes. GPU allocation failure during object creation was not induced; this probe establishes context-loss behavior only.

## Reproduction and outputs

Run `pnpm rust:build`, then `pnpm test:buffers` for the integrated browser suite. Results are saved under `artifacts/buffers/` as `public-native.json`, `public-js.json`, `public-rust.json`, `cross-core.json`, `contract-js.json`, `contract-rust.json`, and `loss-<backend>.json`. The suite compares common native observations and separately compares JS/Rust byte/version metadata. Shader, render, and GPU performance verification are outside this task.

Final integration through `pnpm test:chrome` passed all seven Buffer tests as part of a 34/34 passing suite. Public checks: 171 native and 201 each for JS/Rust, including their diagnostic snapshots. Logical contracts: 36 each for JS/Rust. Cross-core ownership: 16. Loss: 18 native and 20 each for JS/Rust. All recorded checks passed in headed Chrome 157.0.8103.51. These counts include repeated state/error observations and are not independent coverage percentages. Task 006 and the dated dual-core report own the full integration result.

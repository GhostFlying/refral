# Dual-core workspace and Buffer contract

Status is complete for the first common Buffer milestone on 2026-11-13.

## Goal and ownership

Implement the approved first foundation milestone. The integrating agent owns the shared core API, root workspaces/tooling, facade selection and wrapper identity, integration, documentation, and support metadata. A JS worker owns the core-js migration and Buffer adapter. A Rust worker owns the semantic and Wasm crates plus the JS Wasm adapter. A verification worker owns shared Buffer fixtures and three-path Chrome verification.

## Steps

1. Define the Buffer contract and record its ownership and ABI requirements.
2. Move the existing JS implementation to core-js, and establish the common API plus Cargo workspace.
3. Implement real Rust Buffer semantics and Wasm exports, then adapt both cores to the common Buffer API.
4. Make the shared WebGL facade select the requested core and own Buffer wrappers.
5. Verify native WebGL, JS, and Rust/Wasm through common Buffer fixtures, and run existing JS rendering regressions.
6. Update per-core support evidence, architecture, and reproduction instructions.

## Acceptance

- Root JS and Rust build/check/test commands work with pinned toolchains.
- The shared Buffer API uses context-owned generational handles and synchronous input consumption.
- Buffer creation/binding/allocation/update/query/deletion/error behavior passes the same native/JS/Rust Chrome fixtures.
- Tests cover source offsets and mutation, storage/content versions, invalid calls, foreign and stale handles, deletion, and context loss.
- Existing JS rendering, differential, compiler, and CTS regressions pass after migration.
- Rust executes the Buffer semantics in Wasm, and reports its remaining rendering capabilities explicitly.
- The support matrix and task evidence identify each core and tested scope.

## Result and verification

The pnpm/Cargo workspaces now contain `core-api`, `core-js`, `core-wasm`, `crates/core`, and `crates/wasm`. Buffer wrappers and WebIDL normalization belong to the shared facade. The JS adapter reuses the renderer's state; the Rust adapter executes the contract in real Wasm. Explicit Rust selection reports unsupported shader/draw/capture operations. ADR 004 records the ABI and ownership decisions.

`pnpm check` passed strict TypeScript, 25 JS unit tests, rustfmt/clippy, 15 native Rust tests, and validation of 28 support entries for both cores. `pnpm rust:build` produced a 32,950-byte module. `pnpm rust:test:wasm` passed four actual-Wasm tests, including 2 MiB uploads and memory growth. `pnpm test:chrome` passed all 34 tests in headed Chrome 157.0.8103.51 on Apple metal-3. This includes seven shared Buffer tests, explicit profile selection, the existing 18 pixel differential fixtures, five original CTS files with 89 assertions, the 23-case compiler corpus and three real pipelines, the demo, and environment/lifecycle checks. The original trace and paired-native sampling entry points also executed successfully; this milestone makes no new performance selection claim.

`pnpm build` and `pnpm test:dist` passed actual Chrome probe, JS compiler/demo rendering, and a packaged Rust Buffer ABI smoke. `pnpm run doctor` confirmed pinned Rust 1.94.1, Wasm target, components, and Chrome. Raw logs use `artifacts/dual-core-*.log`; Buffer evidence is under `artifacts/buffers/`. See `../validation/2026-11-13-dual-core-buffers.md` for exact boundaries and results.

The initial native loss fixture had an obsolete null-creation expectation. Current Chrome, the WebGL editor's draft, and pinned CTS require fresh invalidated public Buffer wrappers. The facade and common fixture now follow that rule while internal lost-core allocation still returns null. Buffer wrappers also preserve caller-added properties. Task 009 records the probes and sources.

The support matrix uses schema version 2 with independent JS/Rust entries. Rendering and CTS evidence remains scoped to JS; Rust's verified scope is Buffer semantics. Draw/executor types still depend on JS implementation types and will migrate with the next shared rendering contract. No Git commit or remote operation was performed in this milestone.

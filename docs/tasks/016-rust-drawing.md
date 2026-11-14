# Rust drawing semantics and ABI v2

Status is complete for native semantics, ABI v2, and the shared rendering adapter. Task 013 records browser integration and delivery.

## Goal and ownership

Implement task 013's Rust shader/program, vertex, uniform, and minimal drawing semantics in one native context and Wasm instance. This worker owns `crates/core`, `crates/wasm`, `Cargo.lock`, and new rendering adapter files in `packages/core-wasm/src`. The integrating agent owns the shared TypeScript contract, facade, host, existing Buffer adapter, manifests, and delivery.

## Plan

1. Extend the existing native context and retain BufferCore as an alias, sharing Buffer storage, errors, and loss.
2. Implement kind-tagged shader/program/location lifecycle, UTF16 source/names, synchronous compiler request/commit, reflection, and uniform state.
3. Implement FLOAT vertex state, default clear/viewport, and owned TRIANGLES array/u8/u16 draw snapshots.
4. Add private ABI v2 with binding-only serde metadata and binary UTF16/float/draw transport, preserving the original browser artifact during integration.
5. Implement the new rendering adapter against the frozen compiler registry and host contracts.
6. Run meaningful native and candidate-Wasm regressions, record outcomes, and hand off integration.

## Acceptance

Native Buffer regressions continue to pass. New tests cover executable and location lifetime, copied updates, reflection, malformed calls, foreign/kind-invalid handles, UTF16 and unrestricted floats, indexed bounds, snapshot ordering, and context loss. Candidate Wasm builds go to `artifacts/core-wasm-v2/`. The existing `artifacts/core-wasm/refral_core.wasm` remains the ABI1 browser entry until the integrating agent advances the stage.

## Implementation

The existing native context is now `ContextCore`, with `BufferCore` retained as an alias. Its Buffer slots, storage, bindings, error flags, context ID, and loss state serve the new shader/program/attribute paths. Buffer deletion also clears captured attribute bindings. Rendering reads that same Buffer storage and creates owned snapshots with storage/content versions.

Native program state owns attached shader references, pending deletion, latest link status, executable artifact identity, uniform values and packed blocks, and location generations. Compiler prepare/commit uses per-request tokens. Source edits and compilation preserve installed program execution. Linking invalidates old locations, failed linking invalidates current execution, and successful linking installs new metadata with zeroed uniforms. A deleted shader remains live while attached. A deleted current program remains live until unbound.

`packages/core-wasm/src/render.ts` exports `prepareRustModule`, asynchronous `createRustDrawingCore`, and synchronous `createRustDrawingCoreFromModule`. One Wasm instance implements Buffer and drawing operations. Compiler services resolve artifact IDs and supply the host-neutral executable descriptor. The shared host receives owned draw/clear inputs. Successful operations schedule one microtask flush, and explicit flush calls the host directly.

The rendering profile covers FLOAT scalar/vector attributes and constants, float scalar/vector uniforms, default-target viewport/clear, TRIANGLES arrays, and u8/u16 indices. All 19 uniform setter forms accept null locations through the common native ignore path. Nonnull matrix/integer uniforms, other vertex formats, textures, FBOs, and expanded raster state remain subsequent profile work.

## ABI v2 and ownership

The module retains the Buffer exports and reports `rf_abi_version() === 2`. The adapter validates memory and every required function export. `serde = 1.0.228` and `serde_json = 1.0.145` are exact dependencies of the Wasm binding crate, with transitive versions in Cargo.lock. The semantic crate has no external dependencies.

New transport exports are `rf_command_prepare`, `rf_command_pointer`, `rf_command_binary_pointer`, `rf_command_commit`, `rf_reply_pointer`, `rf_reply_length`, `rf_reply_binary_pointer`, and `rf_reply_binary_length`. Prepare allocates Rust-owned metadata and binary input arenas before JS writes. Commit parses the command, executes it, and replaces the reply arenas. The adapter refreshes memory views after allocation and copies the binary reply before returning or invoking the host. The protocol accepts ranges into its owned arenas and validates all offsets and multiplication/addition bounds.

Cold JSON commands contain `op`, `args`, and compiler commit metadata when applicable. Handle arguments retain kind/context/slot/generation. Numeric arguments reference f64 binary words. Strings reference little-endian UTF16 code units, and vector arguments reference f32 words. Shader source and public names preserve lone surrogates through transport. Float values, including NaN and infinities, remain binary in both directions. Metadata has a private 16 MiB protocol ceiling, while source and numeric payloads use the independently allocated binary arena.

Replies contain a typed value descriptor and released artifact IDs. Shader/program reflection and compiler layout use cold metadata. Source, float queries, and compiler source requests use binary replies. Draw replies use the `RFD2` magic and version 2, followed by artifact/program/link identity, target size, viewport, draw counts, attributes with optional owned Buffer snapshots, optional index snapshot, and vertex/fragment uniform byte sections. Explicit section lengths allow bounds validation during decoding. Clear replies carry target size, viewport, mask, color, and depth. Hot draw payloads use binary encoding throughout.

Each active attribute currently receives its own Buffer snapshot. A Buffer referenced by multiple active attributes can therefore appear multiple times in a draw packet. Uploads retain the existing JS-to-staging and staging-to-storage copies. Future measurements must include those costs.

## Validation record — 2026-11-14

| Command | Result |
| --- | --- |
| Pinned Cargo `test --workspace --locked` | 26 passed, comprising 20 semantic tests and 6 binding tests. |
| Pinned Cargo `fmt --all` and `clippy --workspace --all-targets --locked -- -D warnings` | Clean. |
| `pnpm typecheck` | Passed against the integrated shared types and adapters. |
| Release Wasm32 build | Candidate at `artifacts/core-wasm-v2/refral_core.wasm`, 222,803 bytes, ABI v2, no host imports. |
| `pnpm rust:test:wasm` | 9 passed across the existing Buffer and new rendering suites. Actual Wasm runs the shared Buffer contract, UTF16/name queries, compiler requests and relink/lifetime behavior, owned draw snapshots, unrestricted floats, all null uniform setters, clear/indexed decoding, precision validation, attribute limits and edge cases, and microtask submission. |

The integrating agent advanced the default module to the accepted candidate after its integration window. The final nine-test CPU log is `artifacts/program-cores-wasm.log`. Candidate SHA-256 is `d5ddc79d1bccec2cac38e7bd19be228b888a7c1e5d7522b01f2f53515fb7553b`.

Native and actual-Wasm tests use deterministic compiler/host fixtures for state and transport checks. The integrating agent owns ANGLE, Chrome pixel comparisons, original CTS, support reporting, and Git delivery.

### Integration audit

The final retained-deletion audit added a 21st semantic test. Together with six binding tests, the integrated native suite passes 27 tests. Retained shader/program names continue through source/compile/link/query operations, while useProgram rejects a deleted name. Final-retirement queries report INVALID_VALUE, and useProgram reports INVALID_OPERATION. The nine actual-Wasm tests pass against the rebuilt official module. Its build record is `artifacts/core-wasm/build.json`, with 223,445 bytes and SHA-256 `171c1248cb9e8a8ea67425c1344de49110d54f92fcc6b9c132bd7c23d4d6c964`. Task 013 owns the final shared Chrome lifetime scene and deployment checks.

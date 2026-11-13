# ADR 004 — Buffer contract and Rust Wasm boundary

Status is accepted on 2026-11-13 as the implementation boundary for ADR 003's first shared feature.

## Decision

Define Buffer behavior once in `packages/core-api` and the shared fixtures under `tests/core`. Both implementations consume numeric enums, normalized byte views, and immutable context/slot/generation handles. The facade owns extensible JS wrapper identity, WebIDL conversion, and invalidated wrappers created during context loss. Each core owns bindings, validation, errors, storage, versions, deletion, and loss. `docs/core-api.md` defines those observable rules.

The JS adapter uses the same semantic objects as its current renderer, preserving existing draw snapshots. The formal Rust core is independent and implements Buffer semantics in Wasm. A requested Rust context reports capability gaps for rendering features until those features have shared contracts and Rust implementations.

## ABI and ownership

Use a private version 1 `rf_*` ABI with one independent Wasm instance per context and a cached compiled module. The adapter checks all required exports and the ABI version before initialization. The Rust semantic crate has no browser/GPU dependency; the Wasm crate owns the transport arenas. The exact exports, representations, and pointer lifetimes are documented in `packages/core-wasm/README.md`.

Context, slot, and generation fields cross as unsigned i32 values; zero identifies the nullable handle. Sizes, offsets, host capacity, and safe-integer semantic versions cross as f64, preserving range validation before narrowing to Wasm32 allocation sizes. The JS adapter validates handle fields before i32 conversion so malformed values cannot alias live resources.

Uploads prepare a Rust-owned input arena, refresh the memory view, copy the caller's selected bytes, and commit synchronously. Rust consumes those bytes into semantic storage before the public call returns. The current path performs two copies. Inspection creates an owned Rust snapshot and copies it into JS before returning. No export dereferences a caller-selected pointer. Allocation failure reports OUT_OF_MEMORY while preserving valid state. Host limits are a ceiling; address-space and staging-memory limits can fail earlier.

## Verification and evolution

Root checks include TypeScript, deterministic JS unit checks, Rust formatting/clippy/native tests, and per-core support validation. The actual-Wasm adapter suite is separate and requires `pnpm rust:build`; Chrome fixtures compare public state against native WebGL and compare the logical contract and versions between JS and Rust. Dated reports distinguish CPU, actual Wasm, native reference, GPU rendering, CTS, and performance evidence.

Keep the trace experiment independent. Buffer correctness results do not select a preferred runtime core or establish rendering performance. Vertex input, shader/program state, and ordered draw snapshots are subsequent contracts. The existing host's JS-specific execution types migrate with those tasks.

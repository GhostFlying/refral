# Rust Buffer core and Wasm adapter

Status is complete for the Buffer foundation. Shared Chrome integration evidence is recorded by task 009 and the integrating agent.

## Goal and ownership

The Rust worker owns `crates/core`, `crates/wasm`, and `packages/core-wasm`. Implement the shared Buffer contract through real Rust semantics, a private single-context Wasm ABI, and the JS adapter used by the common facade.

## Steps

1. Implement native Rust context-owned generational Buffer handles, bindings, copied storage, errors, inspection, and loss.
2. Add unit tests for upload snapshots, versions, invalid and foreign handles, deletion/reuse, capacity failures, and neutral lost behavior.
3. Export a versioned Wasm ABI with Rust-owned staging and inspection memory, bounds validation, and fallible allocation.
4. Implement `createRustBufferCore` against the common TypeScript contract, including memory-growth-safe views and copied diagnostic snapshots.
5. Run native Cargo checks/tests and actual Wasm adapter tests, then hand off integration details and evidence.

## Acceptance

The core has no external crate dependencies, checks and tests under the pinned toolchain, and exports an actual Wasm implementation. All normal invalid Buffer calls report GL errors without trapping. Inputs are consumed before returning, stale handles remain invalid after slot reuse, and inspection returns owned data. The adapter implements the main-owned BufferCore contract exactly. Browser comparison is coordinated by the integrating agent.

## Implementation and boundary

- `crates/core` (`refral-core`) owns the Buffer semantic state, generational slot reuse, target association, error flags, copied storage, semantic versions, capacity checks, diagnostic snapshots, and loss. It has 11 native behavior tests.
- `crates/wasm` (`refral-wasm`) exposes ABI version 1 with Rust-owned upload and snapshot arenas. Four native ABI tests exercise staging, malformed lengths, error precedence, neutral loss, and result metadata. The browser module imports no host functions.
- `packages/core-wasm` exports `createRustBufferCore(options: BufferCoreOptions, wasmURL?: string): Promise<BufferCore>`. Its default URL is `/artifacts/core-wasm/refral_core.wasm`. It validates export/version compatibility, creates one instance per context, shares compiled modules by URL, copies exact input views synchronously, refreshes arena views after growth, and returns owned inspection bytes.
- Host budgets are nonnegative safe integers and retained as u64 in Rust. Sizes that cannot fit Wasm32 memory, exceed the host budget, or fail a fallible allocation report OUT_OF_MEMORY. Invalid numeric metadata remains a validation error. Input errors preserve storage and versions.
- The facade performs WebIDL conversion and rejects null subdata with TypeError. The core receives byte views for subdata. Nonnull handle validation precedes target validation for bind; usage validation precedes size validation for allocation.

Exact exports, argument representations, pointer lifetimes, failure statuses, and build output names are documented in `packages/core-wasm/README.md`. The ABI currently performs one JavaScript-to-staging copy and one staging-to-semantic-storage copy. This is an implementation fact to include in future measurements; no runtime-core selection or performance conclusion follows from these correctness results.

## Validation record — 2026-11-13

| Command | Result |
| --- | --- |
| Pinned Cargo `fmt --all`, `clippy -p refral-core -p refral-wasm --all-targets --locked -- -D warnings` | Clean. |
| Pinned Cargo `test -p refral-core -p refral-wasm --locked` | 15 passed: 11 semantic-core tests and 4 ABI tests; no failed or ignored tests. |
| `pnpm typecheck` | Passed after adapter and dedicated-test integration. |
| `pnpm rust:build` | Built the release Wasm32 module with Rust 1.94.1, 32,950 bytes; artifact and configuration at `artifacts/core-wasm/refral_core.wasm` and `artifacts/core-wasm/build.json`. |
| `pnpm --filter @refral/core-wasm test:wasm` | 4 passed against the real built Wasm: shared Buffer contract; 2 MiB upload plus forced memory growth and independent snapshots; malformed handle rejection without i32 aliasing; independent contexts sharing one compiled module. |

Dedicated Wasm adapter tests use fetch stubs serving actual compiled bytes and real WebAssembly instances. They require `rust:build` and are separate from the default fast unit suite. These are CPU/ABI correctness results; the integrating agent owns the actual Chrome/native differential run. No GPU performance measurements were made by this task.

## Remaining parity work

Rust supports Buffer semantics only. Shader/program, uniforms, texture/framebuffer state, draw planning, and full rendering remain future shared-contract tasks. The common facade must report explicit Rust capability gaps and must not silently execute those semantic operations in the JS core.

# Rust Buffer core adapter

`createRustBufferCore(options, wasmURL?)` implements the shared Buffer contract with an independent Rust/Wasm instance per context. Its default module URL is `/artifacts/core-wasm/refral_core.wasm`; run `pnpm rust:build` before browser verification.

The `refral-core` crate owns the semantic state and native unit tests. `refral-wasm` exports a private version 1 `rf_*` ABI. The adapter validates exports and ABI version before initialization, shares only the compiled module across contexts, and copies inspection output into owned JavaScript bytes.

An upload calls a prepare export, copies its exact view into Rust-owned staging memory, then calls `rf_upload_commit` synchronously. The core validates metadata before staging allocation and validates again when consuming the staged bytes. No export accepts an arbitrary input pointer. Staging and core storage currently each copy the input; measurement must include both copies. Arena views are recreated after prepare/inspection so Wasm memory growth cannot leave the adapter using a detached view. Snapshot storage remains valid independently of later uploads and deletion.

The output of Cargo package `refral-wasm` is `target/wasm32-unknown-unknown/release/refral_wasm.wasm`. The repository build entry copies it to the default URL. This package covers Buffer semantics only; the common facade reports remaining Rust capability gaps.

Run `pnpm --filter @refral/core-wasm test:wasm` after building to execute the adapter against the actual binary. These CPU tests use a fetch stub serving the compiled bytes; they instantiate real Wasm exports. They run separately from the fast unit suite and require a built artifact. The shared browser Buffer suite also exercises this adapter in Chrome.

## Private ABI version 1

The module exports `memory` and the following functions, with no host imports. Integer arguments/results are Wasm i32 values interpreted as unsigned by Rust; sizes, offsets, host budget, query results, and semantic versions crossing as floating values are f64. The adapter verifies every required function and `rf_abi_version() === 1`.

| Export | Arguments and result |
| --- | --- |
| `rf_abi_version` | No arguments; returns `1`. |
| `rf_init` | `(context_id: u32, max_buffer_bytes: f64) -> u32`; one for successful initialization, zero for invalid options. Context ID must be positive; budget is a nonnegative safe integer. |
| `rf_create_buffer` | Returns the new slot, or zero. |
| `rf_result_generation` | Returns the generation associated with the latest successful create/binding-query result, or zero. |
| `rf_bind_buffer` | `(target, context_id, slot, generation)`; records GL validation errors. |
| `rf_buffer_data_size` | `(target: u32, size: f64, usage: u32)`; validates and allocates zeroed storage. |
| `rf_buffer_data_null` | `(target, usage)`; validates the null allocation call and records its GL error. |
| `rf_buffer_data_prepare` | `(target: u32, byte_length: f64, usage: u32) -> u32`; validates metadata and prepares an input arena. |
| `rf_buffer_sub_data_prepare` | `(target: u32, offset: f64, byte_length: f64) -> u32`; validates the destination range and prepares an input arena. |
| `rf_input_pointer`, `rf_input_length` | Return the current Rust-owned input range. Pointer is usable only after a successful prepare, before another allocation or commit. |
| `rf_upload_commit` | Synchronously consumes the prepared input into semantic storage; without preparation records INVALID_OPERATION. |
| `rf_get_buffer_parameter` | `(target, parameter) -> f64`; size/usage or `-1` for the contract's null result. |
| `rf_get_binding` | `(parameter) -> u32`; slot or zero, followed immediately by `rf_result_generation`. |
| `rf_delete_buffer` | `(context_id, slot, generation)`; clears live bindings and releases semantic storage. |
| `rf_is_buffer` | `(context_id, slot, generation) -> u32`; one/zero, preserving GL errors. |
| `rf_get_error` | Returns and consumes the next GL error flag. |
| `rf_mark_lost` | Returns one for the first transition, zero thereafter. |
| `rf_is_context_lost` | Returns one/zero. |
| `rf_inspect_buffer` | `(context_id, slot, generation) -> u32`; copies an owned Rust snapshot and returns one, or clears the snapshot and returns zero for an invalid handle. |
| `rf_snapshot_pointer`, `rf_snapshot_length`, `rf_snapshot_usage` | Return the current snapshot's byte range and usage. |
| `rf_snapshot_storage_generation`, `rf_snapshot_content_version` | Return exact safe-integer versions as f64. |
| `rf_dispose` | Marks loss and releases buffers, slots, staging, and snapshot allocations. Repeated calls are harmless. |

The nullable handle is exactly `(0, 0, 0)`; other tuples are nonnull and undergo context, slot, and generation validation. JavaScript validates handle fields before passing them through i32 conversion, so malformed fields cannot wrap onto a live object. No function accepts a host-selected pointer. Prepare returns zero when semantic validation or allocation fails, leaving existing storage and bindings intact. Only a successful prepare may be followed by writing `rf_input_length()` bytes and committing. Input staging is private implementation memory and may be reused by the next prepare. Output snapshot bytes remain Rust-owned until the next inspection or disposal; the adapter copies them before returning.

The full host budget is retained even when it exceeds the Wasm32 address range. Such contexts still initialize; impossible or failed Wasm allocations report OUT_OF_MEMORY. Host GPU limits are a ceiling rather than a promise that CPU staging allocations will succeed.

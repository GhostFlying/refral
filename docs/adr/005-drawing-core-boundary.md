# ADR 005 — Unified drawing core and compiler artifacts

Status is accepted on 2026-11-14 for task 013.

## Decision

Extend the shared Buffer contract with a typed logical object family and `DrawingCore`. Each context selects one semantic implementation. Its state includes buffers, shaders, programs, uniform locations, attributes, errors, loss and ordered draw snapshots. The common facade owns JS wrapper identity and WebIDL conversion. It preserves shader/program wrapper identity across queries and returns fresh uniform-location wrappers.

Handles carry `kind`, `contextId`, `slot` and `generation`. Positive u32 fields identify live resources. The kind participates in validation alongside context and generation. A program's link generation additionally invalidates its uniform locations. GL deletion and final retained-reference release are separate state transitions.

The shared compiler service stores compiled shaders and linked executables under context-local artifact IDs. A core owns shader/program status, logs, reflection, link generations and references to those artifacts. Compile/link requests execute synchronously after asynchronous factory initialization. Recompilation, relinking and final deletion release replaced artifacts through the service. Draw snapshots hold the selected executable through host encoding and queued GPU resource lifetime.

`core-api` owns compiler metadata, draw/target/raster records and the semantic host interface. BrowserHost depends on that contract. Both cores emit the same execution records to the same executor. JS retains its broader texture/framebuffer profile while Rust advances through the declared default-framebuffer profile.

## Wasm transport

The private ABI advances to version 2. Each facade context uses one Wasm instance for its complete Rust state. The Buffer ABI entry points remain available for contract tests. Prepared CTS factories cache a compiled module and synchronously instantiate a fresh context after compiler/device preinitialization.

Rust stores shader source as UTF16 code units. The adapter transports DOMString data through explicit little-endian code units, preserving NUL and lone surrogates. Scalar numeric arguments and uniform/attribute values use binary floating-point payloads. NaN and infinities retain their values across transport. Cold compile/link outcomes and reflection use bounded metadata JSON with exact serde/serde_json dependencies confined to the Wasm binding crate.

Draw replies use versioned, length-checked binary packets with owned Buffer and uniform bytes, explicit resource generations and captured state. The adapter copies reply arenas before another Wasm operation can allocate or overwrite them. Uploads consume caller bytes synchronously. Earlier draws retain their versions after updates, reallocation and deletion.

## Verification

Task 013 records CPU/native, actual-Wasm, real-GPU, differential and original-CTS evidence separately. The pinned specification map defines semantics and upstream test identities. The original program-handling CTS case retains its synchronous readPixels prerequisite, and project-derived cases use asynchronous capture with explicit assertions.

Required Actions remain the existing affected-module CPU checks. Full compiler, actual Wasm, GPU and deployment acceptance run through local or optional entry points. Performance selection awaits controlled measurement of this complete path.

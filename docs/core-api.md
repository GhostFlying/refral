# Shared core contract

## First scope

The first common feature is WebGL1 Buffer semantics. Both implementations execute synchronous creation, binding, allocation, subrange update, query, deletion, object checks, errors, and context loss. The shared WebGL facade owns JS Buffer wrappers and selects `core: 'js' | 'rust'`, with JS as the default for existing callers.

The existing JS rendering implementation continues through its adapter while subsequent features acquire common contracts. Rust reports unsupported shader/draw/texture operations through an explicit profile diagnostic. Its Buffer operations execute in the Rust Wasm instance.

## Handles and identity

A Buffer handle is the immutable value `{ contextId, slot, generation }`, with positive u32 fields. Zero is reserved for the nullable ABI representation. Each context receives a process-local context ID from the common JS boundary, and each implementation validates context ownership, slot membership, and generation.

The facade maps opaque, extensible JS wrappers to handles and caches live wrappers by handle. A repeated binding or attribute query returns the existing wrapper. Deleted and foreign handles follow GL behavior. Reused slots receive a new generation and stale handles remain invalid.

## Buffer operations

`BufferCore` is defined in `packages/core-api`. It receives numeric GL enums and Buffer handles. `bufferData` accepts a size, a byte view, or null. `bufferSubData` accepts an offset and byte view. The facade converts ArrayBuffer and TypedArray/DataView inputs into views honoring their byte offset and length. It applies WebIDL integer conversion to enums, sizes, and offsets. A null subdata source raises TypeError at the facade boundary, preserving the core's error flags.

Each core consumes or snapshots uploaded bytes before returning. Earlier draw snapshots retain the earlier bytes. Storage generation advances on bufferData; content version advances on allocations and successful nonempty subrange updates. Failed operations retain bindings, data, usage, and versions.

The factory supplies the host's maximum buffer size to both Buffer implementations. Requests beyond that resource capacity report OUT_OF_MEMORY. Invalid enum, size, offset, ownership, target reuse, and stale handle errors are recorded in the selected core. `getError` consumes error flags. Binding one object to a different Buffer target is INVALID_OPERATION. For a nonnull Buffer binding, ownership and liveness validation precede target-enum validation. Allocation usage validation precedes size validation.

Creation alone leaves `isBuffer` false until first successful binding. Deletion clears affected bindings and JS attribute references. Repeated deletion of an issued handle is harmless, including after its slot is reused. Object checks and diagnostic inspection preserve existing error flags. An empty subrange update validates its offset and preserves versions when valid.

## Inspection and lifecycle

Internal testing inspection returns an owned byte snapshot with size, usage, storage generation, and content version. It returns null for invalid/deleted handles and does not act as a public synchronous GPU readback API.

Context loss reports CONTEXT_LOST_WEBGL once, then NO_ERROR. The internal core's creation returns null and allocates no resource. The public facade returns a fresh invalidated Buffer wrapper on every lost-context `createBuffer()` call, matching current Chrome and the [WebGL editor's draft context-loss rule](https://registry.khronos.org/webgl/specs/latest/1.0/#CONTEXT_LOST). Such wrappers carry a reserved zero-slot marker only at the facade boundary; they are never live logical handles. Queries have neutral results, object checks are false, and mutations are ignored. Context restoration remains outside the current profile. Disposal releases owned CPU resources and any pending host work through its documented lifetime contract.

## Wasm boundary

The Rust core crate owns the semantics and has native unit tests. The Wasm crate exports a private single-context ABI for one instance per facade context. The adapter passes context/slot/generation explicitly and validates ABI version/exports. Uploads use a Rust-owned input arena. The adapter refreshes memory views after allocation or growth and passes bytes synchronously. Inspection returns a copied output view.

Wasm functions validate handle and arena bounds and return explicit status or GL errors for input failures. Allocation failures become OUT_OF_MEMORY. The exact exports are documented by the Wasm adapter and checked by the integration tests. This ABI is scoped to the project adapter.

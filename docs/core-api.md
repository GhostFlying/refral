# Shared core contract

## Shared scope

Both implementations execute WebGL1 Buffer semantics and the default-framebuffer drawing profile introduced by task 013. `DrawingCore` extends `BufferCore` with normalized semantic dispatch and target capture. The facade selects `core: 'js' | 'rust'`, with JS as the default, and owns JS object wrappers and WebIDL conversion.

The shared drawing profile includes ESSL100 shader/program lifecycle and reflection, FLOAT attributes and constants, float scalar/vector uniforms, TRIANGLES arrays and u8/u16 indices, viewport, default color/depth clear, ordered snapshots, submission and asynchronous testing capture. JS also implements its recorded texture/framebuffer and broader raster profile. Rust reports valid operations beyond its declared profile through an explicit library diagnostic.

## Handles and identity

A logical handle is the immutable value `{ kind, contextId, slot, generation }`, with a kind literal and positive u32 fields. Buffer, shader, program and uniform-location handles use distinct kinds. Zero is reserved for the nullable ABI representation. Each context receives a process-local context ID from the common JS boundary, and each implementation validates context ownership, slot membership, and generation.

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

The Rust core crate owns the semantics and has native unit tests. The Wasm crate exports a private single-context ABI for one instance per facade context. The version 2 adapter passes kind/context/slot/generation explicitly and validates ABI version/exports. Uploads use a Rust-owned input arena. The adapter refreshes memory views after allocation or growth and passes bytes synchronously. Inspection returns a copied output view.

Wasm functions validate handle and arena bounds and return explicit status or GL errors for input failures. Allocation failures become OUT_OF_MEMORY. The exact exports are documented by the Wasm adapter and checked by the integration tests. This ABI is scoped to the project adapter.

## Shader and program operations

The selected core owns shader source, compile results, attached shaders, link status, validation status, retained deletion references and current program. The shared compiler registry owns compiled shader and linked executable artifacts under context-local positive IDs. Its synchronous compile/link methods return diagnostics and reflection as well as the artifact ID. Each core releases replaced/finally retired artifacts. The facade disposes the per-context registry when the context is disposed.

Link attempts advance program link generation and invalidate old uniform locations. A failed current-program relink makes later drawing and uniform access produce INVALID_OPERATION. Shader source edits, recompilation and attachment changes preserve the installed executable until a link attempt. A successful link resets uniform values. Shader/program query results map back to the facade's existing wrappers. Uniform-location queries create fresh wrappers and carry the program/link generation through their logical records.

DOMString source is preserved as code units, including NUL and lone surrogates. Numeric input conversion preserves unrestricted GLfloat values. Null uniform locations are ignored after WebIDL argument conversion, including matrix transpose and malformed array-length GL validation. Float vector lists require complete values and their length must be a multiple of the assigned width. Stale, foreign, mismatched and wrong-current-program locations produce INVALID_OPERATION.

## Execution and ownership

Both cores pass shared DrawOperation, TargetSnapshot and RasterState records to SemanticHost. Drawing captures the executable, target dimensions, attributes, uniform bytes and index/vertex Buffer versions observed at the call. Host encoding retains the data needed by queued work. Automatic microtask submission and explicit flush submit encoded operations, while asynchronous testing capture also waits for GPU readback.

Rust uses one context for the complete profile. ABI v2 carries cold metadata in bounded JSON, source/names as explicit little-endian UTF16, numeric payloads as binary floats, and draw results as owned versioned binary snapshots. The adapter copies output arenas before further Wasm calls. Binding-only serde dependencies stay outside the native semantic crate. ADR 005 records this boundary.

# ADR 006 — Resource versions and shared execution

Status is accepted on 2026-11-14 for task 020.

## Decision

Texture, renderbuffer and framebuffer objects use context-owned typed generational handles. Each core owns GL validation, bindings, attachments, format/completeness, deletion and logical versions. The facade owns wrappers and WebIDL adaptation. A per-context ExecutionResources bridge receives ordered neutral operations and resolves version references to stable executor records. It stores no GL state or GPU objects.

A texture reference includes its logical handle, storage generation and content version. Define supplies owned RGBA execution bytes and dimensions. Update supplies owned RGBA subregion bytes and the previous version. The bridge uses the existing executor's copy-on-write TextureStorage path, preserving ordered GPU content and bounded CPU history. A GPU-write operation advances the logical version while aliasing the existing canonical storage, so later sampling observes rendered content. Final retirement releases the canonical record through the host's in-flight retirement path.

The bridge retains the latest logical version for each live texture. Earlier draws already retain canonical records in their encoded operations. Core execution and bridge operations occur in GL order. Renderbuffer depth identities map complete context/kind/slot/generation handles to stable executor IDs, with independent storage generations.

Rust ABI v3 adds i32 argument/result payloads, typed new-resource handles, ordered resource operations, full raster snapshots and offscreen targets. Uniform packing follows compiler reflection including array and matrix strides. Rust source/names retain UTF16 and floats retain unrestricted binary values. Metadata and binary ranges remain bounded and validated before use.

The adapter checks a separate resource protocol capability before context initialization. Capability v1 carries texture operations, and v2 extends packets with typed offscreen targets. Stale artifacts receive rebuild guidance. Definitions and updates retain owned output pixels in Rust until the next command. The adapter validates pointer ranges and copies those bytes synchronously before arena reuse. Reserving bounded operation headers before semantic execution avoids a second large output allocation after committing texture storage.

The selected core executes every supported semantic operation. BrowserHost and the bridge remain shared across the two cores. The final task report distinguishes mock/native/Wasm/GPU/differential/original-CTS/performance evidence.

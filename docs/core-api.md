# Shared core contract

## Shared scope

Both implementations execute the shared WebGL1 drawing and render-to-texture profile. `DrawingCore` extends `BufferCore` with normalized semantic dispatch and target capture. The facade selects `core: 'js' | 'rust'`, with JS as the default, and owns JS object wrappers and WebIDL conversion.

The shared drawing profile includes ESSL100 shader/program lifecycle and reflection, FLOAT and 8-/16-bit integer attributes and constants, float/int/bool scalar/vector arrays, mat2/mat3/mat4, scalar sampler2D/samplerCube, TRIANGLES and TRIANGLE_STRIP arrays and u8/u16 indices, five-format UNSIGNED_BYTE and packed Texture2D/CubeMap uploads and explicit mip sampling, RGBA color/depth framebuffers, raster state, ordered snapshots, submission and asynchronous testing capture. Each core reports valid operations beyond its declared profile through an explicit library diagnostic. The support matrix records verified behavior per core.

## Handles and identity

A logical handle is the immutable value `{ kind, contextId, slot, generation }`, with a kind literal and positive u32 fields. Buffer, shader, program, uniform-location, texture, renderbuffer and framebuffer handles use distinct kinds. Zero is reserved for the nullable ABI representation. Each context receives a process-local context ID from the common JS boundary, and each implementation validates context ownership, slot membership, and generation.

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

The Rust core crate owns the semantics and has native unit tests. The Wasm crate exports a private single-context ABI for one instance per facade context. The ABI5 adapter passes kind/context/slot/generation explicitly and validates ABI version/exports. The resource-envelope capability additionally requires `rf_resource_protocol_version() === 8` before initialization. Capability v1 introduced texture operations, v2 adds typed offscreen targets, v3 adds image target/level identities and dimensional sampler snapshots, and v4 carries a selected mip-level count and an ordered image chain. Capability v5 adds ordered generated mip images, v6 carries color renderbuffer targets and ordered framebuffer copies, v7 carries the auxiliary attachment format, and v8 identifies opaque texture attachments. The check detects stale artifacts before initialization and gives rebuild guidance. Uploads use a Rust-owned input arena. The adapter refreshes memory views after allocation or growth and passes bytes synchronously. Inspection returns a copied output view.

Wasm functions validate handle and arena bounds and return explicit status or GL errors for input failures. Allocation failures become OUT_OF_MEMORY. The exact exports are documented by the Wasm adapter and checked by the integration tests. This ABI is scoped to the project adapter.

## Shader and program operations

The selected core owns shader source, compile results, attached shaders, link status, validation status, retained deletion references and current program. The shared compiler registry owns compiled shader and linked executable artifacts under context-local positive IDs. Its synchronous compile/link methods return diagnostics and reflection as well as the artifact ID. Each core releases replaced/finally retired artifacts. The facade disposes the per-context registry when the context is disposed.

Link attempts advance program link generation and invalidate old uniform locations. A failed current-program relink makes later drawing and uniform access produce INVALID_OPERATION. Shader source edits, recompilation and attachment changes preserve the installed executable until a link attempt. A successful link resets uniform values. Shader/program query results map back to the facade's existing wrappers. Uniform-location queries create fresh wrappers and carry the program/link generation through their logical records.

DOMString source is preserved as code units, including NUL and lone surrogates. Numeric input conversion preserves unrestricted GLfloat values. Null uniform locations are ignored after WebIDL argument conversion, including matrix transpose and malformed array-length GL validation. Float vector lists require complete values and their length must be a multiple of the assigned width. Stale, foreign, mismatched and wrong-current-program locations produce INVALID_OPERATION.

Uniform storage preserves f32 and i32 values through binary channels. Boolean queries return booleans or boolean arrays. Integer vector queries return Int32Array and floating vector/matrix queries return Float32Array. Matrix packing uses column-major input and reflected offset, arrayStride and matrixStride. Complete excess array elements are ignored after filling the remaining declared array. Queries can target a successfully linked program while another program is current.

## Texture and framebuffer resources

The facade preserves the selected typed view's byte offset, byte length and element type. TypedArray/null upload semantics include RGBA, RGB, ALPHA, LUMINANCE and LUMINANCE_ALPHA with UNSIGNED_BYTE. Each core expands input to owned RGBA bytes using unpack alignment, flip and premultiplication state before the call returns. Null texImage2D initializes storage, while null texSubImage2D records INVALID_VALUE. Input failures preserve existing image contents and versions.

TextureVersion contains a typed texture handle, storageGeneration and contentVersion. The per-context ExecutionResources registry receives ordered define, update, write and retirement operations. Definitions and subimage updates carry owned pixels. Draws carry stable version references and sampler parameters. The registry resolves these references to canonical executor records. Replacement materializes ordered GPU copies before retiring the predecessor. An FBO write advances logical content while retaining its GPU allocation, allowing subsequent sampling to consume rendered contents.

Framebuffer attachments retain logical references independently from GL-visible deletion. A color target is a level-zero RGB or RGBA 2D image or CubeMap face, or an RGBA4, RGB5_A1 or RGB565 renderbuffer. A DEPTH_COMPONENT16, STENCIL_INDEX8 or DEPTH_STENCIL renderbuffer can supply the auxiliary attachment. An attached CubeMap must have six matching base faces. The selected face supplies the dimensions and image version for each write and readback. Completeness, feedback checks and attachment queries belong to each core. The bridge resolves color and depth renderbuffers using the complete handle and storage generation. Queued GPU records retain their resources until submitted work completes.

The copy texture operations validate the source and destination in the selected core. They carry the source target and a destination image version through the resource bridge. The BrowserHost clips and encodes the source region in order, with GPU channel conversion and zero initialization or prior content outside the region. [Color and copy decision](adr/013-framebuffer-color-copies.md)

## Execution and ownership

Both cores pass shared DrawOperation, TargetSnapshot and RasterState records to SemanticHost. Drawing captures the executable, primitive mode, target dimensions, attribute component types and normalization, uniform bytes and index/vertex Buffer versions observed at the call. Host encoding retains the data needed by queued work. Automatic microtask submission and explicit flush submit encoded operations, while asynchronous testing capture also waits for GPU readback.

Rust uses one context for the complete profile. ABI v5 carries cold metadata in bounded JSON, source/names as explicit little-endian UTF16, numeric payloads as binary floats or signed integers, and draw results as owned versioned binary snapshots. Resource envelopes bracket execution so uploads precede draws and GPU-write version advances follow them. Pixel payload pointers refer to Rust-owned output storage. The adapter validates ranges and takes independent ownership before another command can reuse that storage. Binding-only serde dependencies stay outside the native semantic crate. ADRs 005 and 006 record this boundary.

## Public readback planning

DrawingCore.prepareReadPixels receives normalized signed 32-bit coordinates/dimensions, unsigned enums and destination view metadata. Both cores validate nullable views, base enums, dimensions, accepted format/type pair, view brand, required byte span and current target completeness. RGBA/UNSIGNED_BYTE is both the supported pair and the implementation-selected pair. Its queries return null with INVALID_OPERATION when the bound framebuffer is incomplete.

The owned ReadPixelsPlan contains a TargetSnapshot, the clipped source rectangle, destinationOffset, destinationStride and requiredBytes. PACK_ALIGNMENT applies between rows. The final row requires only its actual pixel bytes. The full requested span is validated before clipping. Empty intersections return an empty plan. Lost contexts return null. The facade retains the caller's destination and writes only clipped pixel bytes after successful synchronous host capture.

The Rust adapter requires rf_readback_protocol_version() equal to one. A read-pixels reply serializes the existing target followed by four u32 rectangle fields and three safe-integer u64 layout fields. The decoder checks binary ranges and takes ownership before output-arena reuse.

## DOM upload preparation

DrawingCore.prepareDomTextureUpload takes converted GL parameters, intrinsic source dimensions and source availability. It validates without changing texture state or versions and returns the current flip, premultiply and colorspace plan. The facade inspects DOM brands and encoding, then supplies owned or synchronously consumed source bytes to the existing upload command. PixelUpload.source equal to dom denotes tight RGBA with core-owned flip/PMA. The dom-converted marker denotes an extractor's completed transforms. Both paths retain core-owned format normalization. Missing markers preserve typed/null behavior.

Unorm8 sRGB ImageData is accepted in both actual cores, including source-alpha conversion before RGB/luminance format normalization and intrinsic/cross-realm validation. Other source encodings have explicit profile diagnostics. Canvas and HTMLImage have separate acceptance records. DOM preparation also carries optional sourceContextLost. After source availability/dimensions pass, a known lost source records INVALID_OPERATION before ordinary target validation. The Rust adapter additionally requires rf_dom_upload_protocol_version() equal to two before initializing a module. Build manifests, actual-Wasm regressions and deployment verification check this capability alongside ABI5/resource8/readback1.

Canvas/Offscreen sources use WebGPU external copy followed by the opaque Canvas2D transport. This retains WebGL-source alpha-zero RGB and premultiplied bytes. A same-module Refral source registry submits the current default drawing buffer independently of source FBO binding and supplies context-loss facts. HTMLImage uses a lazy private native WebGL extraction context for decoder fidelity, including ICC NONE, with explicit disposal. ADR008 records the runtime dependency, dimension probing and current acceptance boundaries.

## Texture image identity and cube sampling

TextureVersion optionally carries imageTarget and level. Legacy references normalize to TEXTURE_2D/0. ExecutionResources keys and content transitions include that image identity. GPU writes update the current storage reference while retaining its allocation. Cube sampling declares dimension cube and uses canonical storages in CUBE_FACES order. A complete sampled chain sends levels in ascending order, each with one 2D image or six cube faces. Version tuples key the corresponding assembled WebGPU allocation. Missing dimension retains the existing2D binding. ADR009 defines this contract. Task036 supplies its runtime/protocol integration and task037 records complete original DOM CTS acceptance.

Generated mip operations refer to the current predecessor on the same face and own a new versioned image. BrowserHost encodes a box-filter pass when the resource operation is applied, so later source writes only affect a subsequent generation.

# Architecture

## Current direction and implementation

The accepted direction is parallel JS/TypeScript and Rust/Wasm semantic cores with a shared WebGL facade, compiler, browser host, and verification fixtures. ADR 003 records this decision.

The JS implementation lives in `packages/core-js`. Shared contracts cover Buffer semantics, shader/program lifecycle, typed uniforms and matrices, texture/renderbuffer/framebuffer relationships, raster state and ordered multipass drawing in JS and Rust/Wasm. The earlier trace experiment remains under `experiments/core-selection` as a separate measurement tool.

| Module | Responsibility |
| --- | --- |
| `packages/webgl` | Shared public facade, JS wrappers, and input adaptation |
| `packages/core-api` | Shared semantic interface, logical handles, and execution data types |
| `packages/core-js` | JS/TypeScript semantic implementation |
| `packages/core-wasm` | JS adapter connecting Rust/Wasm exports to the common interface |
| `crates/core` | Rust semantic implementation with host-neutral data and interfaces |
| `crates/wasm` | Rust Wasm exports and ABI adaptation |
| `packages/compiler` | Shared ANGLE Wasm compilation and program finalization |
| `packages/browser-host` | Shared concrete WebGPU execution |

## Public entry

`createWebGLOnWebGPU(canvas, { version: 1, core: 'js' })` initializes the device and compiler before returning a WebGL1-like context. JS is the default. `core: 'rust'` initializes the formal Rust Wasm module and executes the shared drawing profile in one instance. Supported calls remain synchronously observable. Valid operations beyond the selected profile report `NotSupportedError`.

## Modules

- `packages/webgl` adapts WebGL calls and owns wrapper identity.
- Each semantic core owns state, validation, logical resources, and ordered snapshots through the shared contract.
- `packages/compiler` owns ANGLE Wasm loading, ESSL translation, reflection, and program finalization.
- `packages/browser-host` owns GPU resources and executes ordered rendering work.
- The testing harness uses native WebGL references, the public synchronous readPixels entry and an internal asynchronous pixel-capture entry.

## Initial execution

Use a single owner thread. Schedule automatic submission at the current task's microtask checkpoint, and submit explicitly on `flush`. Uniform and resource updates preserve the values observed by earlier draws. GPU work holds resource references through submission.

## Synchronous readback

The selected core validates readPixels and returns an immutable plan containing the current target, clipped rectangle and destination layout. The facade converts WebIDL values and checks destination storage before calling the core. BrowserHost ends pending passes and synchronously captures only the intersecting region through a private WebGPU canvas and an opaque sRGB Canvas2D transfer. The facade copies completed RGBA8 rows into the caller view before returning, preserving padding and out-of-framebuffer bytes.

The ordinary Chrome path uses the existing caller thread and public factory. Empty rectangles skip GPU capture. Device loss and disposal are observed by the core before planning. The Rust adapter requires readback capability v1 alongside ABI3/resource-protocol3. ADR 007 records the accepted backend and verified scope.

## Resource model

The common Buffer interface uses context-owned generational handles. The facade associates opaque JS wrappers with those handles and normalizes WebIDL inputs. Both cores own Buffer validation, storage, and errors. See `core-api.md` for synchronous data ownership, validation order, and lifecycle rules.

The facade maps typed logical handles to context-owned wrappers for buffers, shaders, programs, textures, renderbuffers and framebuffers. The JS adapter maps these handles to its semantic objects. Rust executes its own state, validation and planning through ABI v3. Both paths emit the same execution records to BrowserHost through core-api.

Each context owns an ExecutionResources registry. Cores produce ordered texture definitions, subimage updates, GPU-write version advances and retirement operations. The registry resolves typed texture versions to canonical executor storage and maps depth handles plus storage generation to executor identities. Draw records reuse these references. FBO contents stay in GPU resources through the write-to-sample transition. The registry owns resource translation and retains no GL binding state.

Texture image identity includes the logical texture handle, image target and level. Each unit retains independent 2D and cube bindings. Complete cube snapshots carry six canonical images. BrowserHost caches a six-layer cube texture against all six versions and retires previous aggregates through submission completion. ADR 009 records the image and sampling contract.

Storage generation changes when storage or views are replaced. Content version changes on data updates. Program link generation invalidates uniform locations and executable-derived caches. GPU resource lifetimes follow queued work as well as GL-visible references.

TypedArray/null texture input is consumed before the upload call returns. The selected core expands the supported UNSIGNED_BYTE formats with unpack state, retaining independent owned RGBA payloads. Framebuffer attachment relationships retain deleted logical resources until the last reference is released. BrowserHost retires replaced concrete resources after submitted work completes.

The private Rust resource protocol requires ABI v3 and resource-envelope capability v3 for image-subresource versions and cube sampling snapshots. Bounded metadata and binary ranges carry typed results, full raster/target snapshots and ordered operations. The adapter copies Rust-owned output pixels before reusing the output arena. ADR 006 records the resource and transport boundary.

## Compiler integration

ANGLE compiler and required support components are pinned and compiled to Wasm. Compiler output contains diagnostics, reflected shader variables, final stage WGSL, attributes, uniforms, and binding layouts. The compiler worker defines the narrow adapter contract with the integrating agent before runtime integration. Link finalization accounts for ANGLE's translated-source location and sampler placeholders. A per-context registry gives compiled shaders and linked programs numeric artifact IDs. Cores own their references and release artifacts on replacement/final retirement. ADR 005 records typed handles and transport details.

## Test boundaries

Browser tests use actual installed Chrome and real WebGPU operations. Both cores use shared behavior fixtures and native references as they implement the contract. Internal asynchronous readback supports image comparison. CTS bootstrap prepares the context and records all test-adapter modifications. Support and results identify the tested core and capability gaps.

## Official conformance execution

The official runner adapter self-hosts the complete pinned `sdk/tests` subtree and executes the original WebGL1 version 1.0.4 inventory through native, JS and Rust. Document-start context hooks preserve synchronous acquisition after per-file asynchronous factory initialization. The original runner owns list parsing, assertions and scheduling. [ADR 010](adr/010-official-conformance-adapter.md) records source provenance, outcomes, recovery and adapter scope.

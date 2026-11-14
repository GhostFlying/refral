# Architecture

## Current direction and implementation

The accepted direction is parallel JS/TypeScript and Rust/Wasm semantic cores with a shared WebGL facade, compiler, browser host, and verification fixtures. ADR 003 records this decision.

The JS implementation lives in `packages/core-js`. Shared contracts cover Buffer semantics, shader/program lifecycle, vertex/uniform state and ordered default-framebuffer drawing in both JS and Rust/Wasm. The earlier trace experiment remains under `experiments/core-selection` as a separate measurement tool.

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
- The testing harness uses native WebGL references and an internal asynchronous pixel-capture entry.

## Initial execution

Use a single owner thread. Schedule automatic submission at the current task's microtask checkpoint, and submit explicitly on `flush`. Uniform and resource updates preserve the values observed by earlier draws. GPU work holds resource references through submission.

## Resource model

The common Buffer interface uses context-owned generational handles. The facade associates opaque JS wrappers with those handles and normalizes WebIDL inputs. Both cores own Buffer validation, storage, and errors. See `core-api.md` for synchronous data ownership, validation order, and lifecycle rules.

Migration is incremental. JS Buffer handles adapt the same objects and state used by its existing renderer. Shader/program handles and compiler/execution records now use core-api. BrowserHost consumes that common contract. The JS adapter maps logical handles to its existing semantic objects, and Rust emits the same draw records through ABI v2. Texture and framebuffer semantics remain the next Rust parity work. Selecting Rust executes its own state, validation and planning against the shared compiler/executor.

Storage generation changes when storage or views are replaced. Content version changes on data updates. Program link generation invalidates uniform locations and executable-derived caches. GPU resource lifetimes follow queued work as well as GL-visible references.

## Compiler integration

ANGLE compiler and required support components are pinned and compiled to Wasm. Compiler output contains diagnostics, reflected shader variables, final stage WGSL, attributes, uniforms, and binding layouts. The compiler worker defines the narrow adapter contract with the integrating agent before runtime integration. Link finalization accounts for ANGLE's translated-source location and sampler placeholders. A per-context registry gives compiled shaders and linked programs numeric artifact IDs. Cores own their references and release artifacts on replacement/final retirement. ADR 005 records typed handles and transport details.

## Test boundaries

Browser tests use actual installed Chrome and real WebGPU operations. Both cores use shared behavior fixtures and native references as they implement the contract. Internal asynchronous readback supports image comparison. CTS bootstrap prepares the context and records all test-adapter modifications. Support and results identify the tested core and capability gaps.

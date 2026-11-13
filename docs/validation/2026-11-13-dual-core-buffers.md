# Dual-core Buffer foundation — 2026-11-13

The first common Buffer milestone passed in both JS/TypeScript and actual Rust/Wasm. JS keeps its existing WebGL1 rendering profile. Rust's verified public scope is Buffer semantics; shader/program, vertex input, uniforms, textures, framebuffer state, and drawing remain subsequent parity work.

## Environment and source

- macOS arm64; headed installed Chrome `157.0.8103.51`, Playwright `chrome` channel, isolated profile, one test worker, viewport 1000 × 760, DPR 1. No additional launch arguments.
- Actual non-fallback WebGPU adapter: vendor `apple`, architecture `metal-3`. The Buffer contexts used a device `maxBufferSize` of 268,435,456 bytes. Full capabilities and returned context attributes are in the per-backend evidence.
- Node `24.14.0`, pnpm `10.12.3`, pinned Rust `1.94.1`, target `wasm32-unknown-unknown`. The doctor records resolved paths and installed components, including NVM/PATH discovery.
- Rust Buffer release Wasm: 32,950 bytes; SHA-256 `88e5dc3aab40d9978dd81c521b1bb79b996c447d01de5ee01fe2723f34560589`. The module has no host imports. Build metadata is at `artifacts/core-wasm/build.json`.
- At the time of this validation, the checkout had no Git commit. `pnpm snapshot` recorded per-file hashes and a complete source-tree identity. A dated evidence copy is preserved under `artifacts/validation/2026-11-13-dual-core-buffers/`, including its source manifest. No commit or push was performed as part of that validation; task 010 records subsequent repository publication.

## Implemented boundary

The root pnpm/Cargo workspaces contain the common contract, migrated JS core, independent Rust semantic core, private Wasm ABI, and JS Wasm adapter. The shared facade owns opaque extensible Buffer wrappers and WebIDL normalization. Context/slot/generation handles identify core resources. Both cores consume uploads synchronously, preserve state after errors, and separate storage generation from content version. ADR 004 and `docs/core-api.md` define these rules.

The JS adapter shares objects, bindings, errors, and upload bytes with the existing JS renderer. Rust Buffer calls execute in its own Wasm instance. Explicit Rust selection reports `NotSupportedError` for shader creation, drawing, and pixel capture. The current host's draw data types still depend on the JS implementation; migrating them is part of the next shared rendering contract.

## Acceptance results

| Command | Result and boundary |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed with the migrated workspace packages. Lockfile resolves the pinned packages through the public npm registry. |
| `pnpm run doctor` | Passed; pinned toolchain, components, Wasm target, compiler tools, and Chrome found. |
| `pnpm check` | Strict TypeScript passed; 25 JS unit tests passed; rustfmt and clippy with warnings denied passed; 15 native Rust tests passed; 28 support entries validated independently for JS/Rust. |
| `pnpm rust:build` | Built and copied the actual release Wasm module. |
| `pnpm rust:test:wasm` | Four tests passed against real compiled Wasm, with a fetch stub serving those bytes. Includes shared contract, 2 MiB upload/memory growth, malformed handles, owned snapshots, and independent instances sharing one compiled module. |
| `pnpm test:chrome` | 34 passed, zero failed/skipped/flaky, 29.7 seconds in the final locked-dependency run. Full report: `artifacts/chrome-results.json`; command log: `artifacts/dual-core-chrome.log`. |
| `pnpm build` | Passed; deployment includes compiler, formal Rust core, original trace experiment, and pinned demo resources. |
| `pnpm test:dist` | Passed actual Chrome WebGPU probe, built JS compiler/demo rendering, controls/page-error checks, and loading/exercising the packaged Rust Buffer ABI. This deployment smoke is distinct from the source-mode full facade tests. |

The 15 native Rust tests are 11 semantic tests plus four ABI tests. The four actual-Wasm tests are a separate suite requiring a built artifact. Default unit checks do not silently skip absent Wasm artifacts.

## Shared Buffer evidence

The seven Chrome Buffer tests exercise the same public calls through native WebGL, JS, and Rust/Wasm; check cross-core ownership; run the same logical contract in each implementation; and verify native/JS/Rust loss behavior.

| Evidence under `artifacts/buffers/` | Passing named checks |
| --- | ---: |
| `public-native.json` | 171 |
| `public-js.json` | 201 |
| `public-rust.json` | 201 |
| `cross-core.json` | 16 |
| `contract-js.json` | 36 |
| `contract-rust.json` | 36 |
| `loss-native.json` | 18 |
| `loss-js.json` | 20 |
| `loss-rust.json` | 20 |

Counts include repeated observations of state and errors, and do not represent independent coverage percentages. The common native observations match in both implementations. JS/Rust byte snapshots and resource versions also match. Native WebGL1 has no Buffer byte-readback query, so this milestone does not claim native byte-readback comparison for Rust. JS retains its existing pixel regressions for uploaded drawing data.

Cases include view offsets, caller mutation after return, allocation/reallocation, empty and null sources, fractional/NaN/infinite numeric inputs, invalid targets/usage/ranges, validation order, wrapper identity and user properties, deleted and foreign objects, slot reuse/stale generations, configured capacity failure, error-state preservation, and loss. Allocation limits and memory-growth correctness are tested; general memory exhaustion was not induced.

The first integrated run found an outdated lost-context fixture expectation. Current Chrome and the [WebGL editor's draft](https://registry.khronos.org/webgl/specs/latest/1.0/#CONTEXT_LOST) create invalidated public Buffer objects while lost. The [pinned CTS context-loss assertions](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/conformance/context/context-lost.html#L318) expect nonnull objects with false `isBuffer` before and after binding. The facade and shared fixture were corrected, then all three paths passed. Internal `BufferCore.createBuffer()` still returns null during loss and allocates no logical resource. That CTS file was consulted as a reference and is not counted among the five selected CTS files.

## Existing rendering regression

The full Chrome run also passed the 18 existing JS/native pixel differential fixtures, the pinned render-to-texture demo and backend control, device loss and environment probes, and five original CTS files with 89 assertions. The standalone ANGLE corpus passed 23 cases and generated three accepted real WebGPU pipelines. These shader/CTS/rendering results remain JS or standalone compiler coverage; they do not establish Rust rendering parity.

The original synthetic JS/Rust trace experiment and paired native-WebGL/JS CPU sampling tests executed successfully. Their artifacts retain their actual units and workload boundaries. This Buffer milestone does not measure formal dual-core rendering performance or FPS and makes no runtime selection decision. The Rust upload adapter currently copies JS input into staging and then into semantic storage; subsequent measurements must include both copies.

## Reproduction and continuation

Follow the setup in `README.md`, acquire the pinned dependencies, and build the compiler, original trace experiment, and formal Rust module. Then run the commands in the acceptance table. The focused browser entry is `pnpm test:buffers`.

Raw command logs use `artifacts/dual-core-*.log`; the native probes and per-core results are under `artifacts/buffers/`. Rendering, CTS, compiler, environment, and built deployment evidence retain their existing artifact paths and are copied into the dated evidence directory. `docs/support.json` schema 2 records support independently by core.

Next define common vertex-input and draw-snapshot types, then take Rust through the first real triangle using the shared compiler and executor. Keep the shared Buffer fixtures as parity regressions while adding shader/program and draw contracts.

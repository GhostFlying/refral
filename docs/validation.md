# Chrome first-phase verification

Recorded on 2026-11-13 in Asia/Singapore.

## Environment and source provenance

Verification used installed Google Chrome 157.0.8103.51 in headed mode on macOS arm64. The WebGPU adapter reported Apple, `metal-3`, and `isFallbackAdapter = false`. Playwright used its `chrome` channel, isolated profiles, DPR 1, and one GPU worker. The Browser plugin was absent during implementation, so the approved regular Playwright workflow supplied browser verification.

`artifacts/environment/doctor.json` records exact tool paths and versions. `artifacts/environment/chrome-probe.json` records the adapter, capabilities, native WebGL renderer, real drawing, asynchronous readback, and shader diagnostics. `artifacts/environment/source.json` records the working-tree SHA-256 manifest. Third-party source revisions are pinned in the compiler manifest and `fixtures.lock.json`.

## Executed acceptance

| Entry | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed with all workspace packages present |
| `pnpm check` | Strict TypeScript, 18 unit tests, and 27 support-matrix groups passed |
| `pnpm compiler:test` | 23 actual Wasm compiler/linker cases passed |
| `pnpm test:chrome` | 26 tests passed in the final integrated run |
| Chrome compiler | 23 corpus cases and 3 actual WebGPU pipelines passed |
| JS/Rust selection | 9 CPU-path comparisons and 9 real GPU proofs passed |
| WebGL1 differential | 18 cases passed within the declared one-byte tolerance |
| Original Khronos CTS | 5 files and 89 original assertions passed for the compatibility context and native reference |
| Render-to-texture demo | 320×240 output had zero pixels differing beyond its declared two-byte tolerance |
| Device loss | Notification, lost error, neutral query/create results, and disposal checks passed |
| `pnpm build` | Browser bundles and adjacent compiler/demo/experiment assets generated |
| `pnpm test:dist` | Built assets loaded and rendered in Chrome, with working controls and no page errors |

The semantic differences cover uniform snapshots, vertex/index updates, caller input mutation, storage replacement, stale locations, invalid shaders, masked/scissored clear, framebuffer sampling, context ownership, state after errors, automatic submission, texture direction, depth/blend, resize, constant alpha, RGB/LUMINANCE zero initialization, index-format cache identity, and texture subimage ordering.

The demo adapter injects the context/canvas and exposes a deterministic frame callback. Shader and rendering code come from the pinned upstream example. Its image comparator permits a two-byte channel difference and a one-pixel raster-edge neighborhood. The final run needed no neighborhood matches because no pixels exceeded the direct channel tolerance. Native and compatibility images are retained under `artifacts/demo`.

CTS runs preserve original scripts, assertion text, and identities. The test bootstrap initializes the device/compiler and scopes context acquisition to the iframe. Upstream utilities emit WebGL1-version inference warnings. Actual assertion and script error arrays are preserved in `artifacts/cts/results.json`.

## Runtime-core decision

ADR 001 selects TypeScript for the first Chrome production core. Per-command Rust/Wasm measurements showed mixed costs across uniform, state/cache, and upload traces. The experiment retains the Rust implementation, per-command and batched paths, original samples, build hashes, and a common WebGPU executor.

Decision samples are preserved as `artifacts/core-selection/decision-chrome.json` and `decision-node.json`. Routine reruns write separate latest-result files. These measurements cover the documented small-core trace and bridge boundaries.

## Initial native-WebGL comparison

The following CPU samples average eight frames per timed sample. Each frame records 64 draws. Each path uses 30 warmup samples and 120 recorded samples. Readback pacing occurs outside timing, and native/compatibility paths use the same canvas configuration and content.

| Scene | Native p50 / p95 ms | Refral p50 / p95 ms |
| --- | --- | --- |
| Uniform updates and draws | 0.0000 / 0.0125 | 0.2625 / 0.3000 |
| State changes | 0.0125 / 0.0250 | 0.2875 / 0.3000 |
| Dynamic uploads | 0.0125 / 0.0250 | 0.3500 / 0.3875 |

Zero-valued native samples reflect browser timer quantization. The samples measure API processing, encoding, and submission CPU time. GPU duration remains unmeasured. This is an initial single paired run with retained browser/module/driver caches, so repeated thermal/cache-controlled runs belong to subsequent performance work.

The prototype has higher CPU costs than native WebGL in these scenes. Current counters expose per-draw uniform buffers and bind groups, submission-scoped vertex/index materialization, and presentation work as optimization targets. Raw samples and counters are retained in `artifacts/benchmarks/chrome.json`.

Tracked peak buffer capacities were 17,280 bytes for uniform/state scenes and 41,472 bytes for dynamic upload. Texture capacity was estimated as 32,768 bytes for the 64×64 color/depth setup. These figures describe executor-tracked capacity. Driver VRAM and total process memory require separate measurement. The compiler configures a 32 MiB initial Wasm linear memory with growth enabled.

## Initial profile and continued work

The runtime advertises eight attribute locations, single sampling, stencil disabled, and retained drawing-buffer contents through `preserveDrawingBuffer = true`. Its actual attributes and compiler resource limits share a fixed profile. Matrix attribute reflection/link locations are verified, while matrix-attribute draws produce an explicit profile diagnostic.

Synchronous GPU readback, mip generation, additional primitive types, complex sampler/uniform layouts, expanded context attributes, full recovery, and broader CTS coverage are follow-up capabilities. DOM image uploads and non-default pixelStore combinations have implementation paths with unverified coverage recorded in the support matrix.

P3 priorities are CTS expansion, persistent upload arenas and resource reuse, bind-group allocation reduction, and more complete context/texture behavior. P4 depends on inspecting the actual existing internal command buffer and Dawn ownership/thread interfaces. The browser artifacts establish the public Chrome path.

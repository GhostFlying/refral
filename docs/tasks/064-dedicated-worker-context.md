# Dedicated Worker execution and context provenance

## Scope and dependencies

Task 061 initialized same-thread OffscreenCanvas contexts. Task 064 runs pinned same-origin classic dedicated worker scripts inside actual worker realms. Each selected worker owns a prepared compiler, hardware WebGPU device and semantic core. Its synchronous OffscreenCanvas context hook observes the WebGL1 context mode and repeated acquisition. Preserve worker URL-relative imports, unmodified original assets, ordinary worker replies, transferable ownership and typed-array semantics. Report zero-context CPU workers independently from GPU workers. Worker-side loss, unsupported extensions, transfer and method failures retain their real results.

The task owns test-only worker bootstrap, the official server's marked worker entry, per-case metadata, regressions, and the worker-related adapter ADR. The normal asynchronous public factory and application Worker constructor keep their usual behavior.

## Plan and acceptance

1. Prepare worker execution before original WebGL calls. Carry the actual selected-core identity and canvas surface from the worker into the official result. Keep missing initialization, unsupported worker types, uncaught exceptions and device diagnostics visible.
2. Preserve messages posted during startup, including immediate detachment on transfer. Keep the original worker script and its relative importScripts execution on the dedicated worker. Record failures and successful zero-context execution without treating every Worker construction as a coverage gap.
3. Run TypeScript, deterministic adapter/asset checks and the production build. Exercise actual worker-hosted public factory drawing/readback with JS and Rust. In the shared headless Chrome window run the originals matching `^conformance/(typedarrays/typed-arrays-in-workers|offscreencanvas/(context-creation-worker|context-lost-worker|methods-worker))\.html$`, then inspect per-case worker readiness, actual core, assertions and errors.

## Results

Both public GPU worker tests created a selected context on a transferred OffscreenCanvas and returned the expected green pixel on the hardware adapter. TypeScript, 226 unit cases, 65 deterministic Node tests and the release build passed. The five official files produced fifteen case-page screenshots. Every Worker acknowledged initialization and each worker WebGL context reported the requested actual core. The TypedArray job recorded zero WebGL contexts.

| Original | Chrome native passed/failed | JS passed/failed | Rust passed/failed |
| --- | --- | --- | --- |
| context-creation-worker | 2/0 | 2/0 | 2/0 |
| methods-worker | 1/1 | 2/0 | 2/0 |
| typed-arrays-in-workers | 121/0 | 121/0 | 121/0 |
| context-lost-worker | 5/0 | 1/2, timeout | 1/2, timeout |
| context-lost-restored-worker | 2/0 | 1/1, worker exception | 1/1, worker exception |

The loss originals reached the selected worker and encountered the missing WEBGL_lose_context extension. The former also expects OES_vertex_array_object. Both genuine worker outcomes remain in the campaign. Native methods-worker reports the original aggregate method-list failure. Full counters, diagnostics, images, adapter and public worker log are under `artifacts/conformance/campaign/dedicated-workers/`. Task 068 extends worker source coverage to Blob and nested workers, and task 069 owns context loss and restoration.

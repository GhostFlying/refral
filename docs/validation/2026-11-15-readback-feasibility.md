# Synchronous readback feasibility

Recorded on 2026-11-15 for task025, introduced from main `67c20c9`. The accepted recapture uses main `822948b` plus the reporter-path correction. Task026 supplies the pinned CTS source audit. The capture-time source inventory and per-file hashes are retained in `artifacts/readback/source.json`. Documentation was completed after that capture. Final PR and integration revisions are recorded in `artifacts/readback/delivery.json`.

## Implemented experiment

`pnpm test:readback` launches installed headed Chrome with DPR1, an isolated test profile and one GPU test worker. It owns ordinary port 4175 and cross-origin-isolated port 4176. The latter uses the existing benchmark server's COOP/COEP headers. Both servers disable development HMR. The user's port 4173 development server continues to serve the demo.

The selected actual JS or Rust DrawingCore, ANGLE compiler registry and ExecutionResources run on the caller. A private SemanticHost adapter snapshots ordered host operations and sends them to the existing BrowserHost on an independent GPU worker's OffscreenCanvas. Each synchronous capture waits for that worker's actual GPU readback, validates a completion sequence/length, and takes an owned copy before reusing shared storage. Window callers poll. Worker callers use Atomics.wait, while GPU callbacks run in a second worker.

The private protocol has one outstanding request and a 64-byte header plus a 320×240×4-byte payload. Its tested formats and dimensions are intentionally bounded. The existing BrowserHost canvas parameter is structurally cast for this experiment because the used width/height/getContext methods exist on OffscreenCanvas. Production host typing and user-canvas presentation need their own integration.

## Environment and builds

The run used headed Chrome 157.0.8103.51, Apple M4 Max, arm64 Darwin 25.6.0 and the hardware WebGPU adapter apple/metal-3 with isFallbackAdapter=false. Raw records retain the actual Chrome process command line, machine, selected core, adapter/capabilities, source inventory and build hashes. The measured minimum positive timer delta was approximately 0.005 ms in the isolated rendering placements.

- Rust Wasm uses ABI3/resource protocol2 and SHA-256 `e407526a05e998a987c90de691d5f679494df7b3ec27b1501693f27815d982ea`.
- Compiler Wasm SHA-256 is `954a24680f8a5a799dd2d72dd66193b56526ec96047f6cc2badf247836f0a49f`.
- Node 24.14.0, pnpm 10.12.3 and Rust 1.94.1 match the existing pinned setup.

## Observed completion and wait behavior

| Placement | Observed result |
| --- | --- |
| Ordinary Window, GPU owned by Window | SharedArrayBuffer constructor unavailable. Cloning a Wasm-created shared buffer gives DataCloneError. Mapping remains pending during a 30 ms task, and getMappedRange gives OperationError. |
| Isolated Window, GPU owned by Window | Shared memory available. Atomics.wait gives TypeError. Mapping callback remains pending during polling and completes after yielding. |
| Isolated worker, GPU owned by that waiting worker | Atomics.wait is available, but the pending mapping callback completes after the wait times out and the task yields. |
| Isolated Window core, independent GPU worker | Both cores return fresh completed pixels synchronously through polling and shared storage. Window timer ticks during the synchronous sequence are zero. |
| Isolated worker core, independent GPU worker | Both cores return fresh completed pixels through Atomics.wait and shared storage. Window timers continue while the worker caller waits. |

These are observations of the tested Chrome arrangement. WebGPU's mapping API and HTML's worker/shared-memory rules explain the async completion and deployment boundaries. [WebGPU mapping](https://www.w3.org/TR/2026/CRD-webgpu-20260915/#dom-gpubuffer-mapasync), [HTML agents](https://html.spec.whatwg.org/multipage/webappapis.html#agents-and-agent-clusters), [shared serialization](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal)

## Correctness and failure acceptance

Seven experiment cases and four existing CTS/demo smoke cases passed in 13.8 seconds. Each rendering placement executes 32 regular images, covering two dimensions, default/FBO targets and eight repetitions. Images alternate left/right uniform colors and a GL-row-zero marker. All 128 regular images plus four post-error recovery images have zero mismatched channels. The retained earlier result remains unchanged after subsequent shared replies. Local synchronous getUniform/getError checks pass on both cores.

Each placement publishes the injected error at sequence 33, successfully renders sequence 34, then exceeds a 5 ms client deadline with an injected 100 ms worker stall. Timeout closes the client and terminates its GPU worker. Initialization/disposal handshakes have separate bounded deadlines. These tests exercise transport failure and timeout handling. Device loss, production resource retirement and arbitrary GL validation require subsequent acceptance.

The unchanged selected CTS suite remains eleven original files with 243 passing assertions for each of native, JS and Rust. The baseline project also passes sequential render-to-texture frames and both backend controls. Its results are in `artifacts/cts/results.json` and `artifacts/readback/chrome-results.json`.

An earlier smoke attempt reused the active HMR-enabled development server while TypeScript configuration reloads were occurring. Two initial CTS evaluations were interrupted by navigation. Its log remains in `artifacts/readback/smoke-navigation-interrupted.log`. The accepted command owns HMR-disabled servers, and its complete original-assertion run passes.

## Timing observations

Each cell below is the median synchronous capture round trip in milliseconds from eight consecutive samples, with zero prewarm samples. Contexts and worker instances are fresh per placement. The Chrome process and unmanaged driver caches persist. The first default capture includes first-pipeline creation, and the raw records retain its larger cold sample. This small trace supplies feasibility and blocking-cost observations.

Round-trip timing starts before posting queued immutable host operations and ends after host execution, GPU completion/map, worker shared-memory publication and the caller-owned result copy. Semantic GL processing and local snapshots precede that interval and have a separate clientEncodingMs field. Worker encoding and capture phases are also recorded. The existing RTT baseline has a separately documented CPU encoding/submission boundary. GPU-only duration remains unmeasured here.

| Caller | Core | 64×64 default | 64×64 FBO | 320×240 default | 320×240 FBO | Initialization |
| --- | --- | --- | --- | --- | --- | --- |
| window | js | 0.7100 | 0.6400 | 0.6125 | 0.7775 | 37.820 |
| window | rust | 0.7050 | 0.5575 | 0.7400 | 1.0750 | 32.970 |
| worker | js | 0.8325 | 0.5775 | 0.6325 | 0.9300 | 27.675 |
| worker | rust | 0.8625 | 0.5825 | 0.6200 | 0.9300 | 33.780 |

Initialization covers GPU worker/device setup, compiler/core construction and shader/resource preparation. It precedes capture timing and includes fetched Wasm under the run's browser cache state. The raw synchronousSequenceMs includes image assertions, queries, injected-error recovery and timeout work. It describes the observed caller-blocking sequence. The timer samples for Window progression are observational scheduling checks.

Raw placement/primitive records, `summary.json`, `source.json` and the Playwright JSON report are under `artifacts/readback/`. The command log is `artifacts/readback-spike.log`.

## Production integration and CTS order

[ADR 007](../adr/007-synchronous-readback.md) remains proposed. The tested shared-reply paths need a secure context, cross-origin isolation and an independent GPU callback agent. Window polling consumes CPU and blocks its event loop. A worker API caller can wait while Window remains responsive. The experiment uses its own canvas and a private fixed-capacity protocol. Public readPixels validation, destination views and PACK_ALIGNMENT, clipping, current-target state, error/loss propagation, ordered retirement, presentation and resize remain explicit implementation work. The public support matrix continues to list readPixels as unimplemented.

The [CTS dependency audit](../references/cts-readback-dependencies.md) traces all five deferred originals. Their pixel helpers consume readPixels results immediately. Program-handling and feedback-loop are the closest candidates after production readback and an iframe context-brand adapter. The original checkCanvas path uses native instanceof checks that the structural facade fails. CubeMap, mipmaps, packed types, canvas uploads and extra renderbuffer/query/copy-error behavior gate the other files. The lock file now records those prerequisites precisely. Audited new candidates have source evidence and await execution.

DOM input work follows its own shared facade ownership and conversion task. Buffer version reuse follows the observed Rust upload duplication with invalidation and queued-work tests. These remain separate implementation tasks in the roadmap.

The initial reporter configuration resolved its relative JSON path under the experiment directory. A follow-up fix uses an absolute root-artifacts path. The accepted recapture verifies artifacts/readback/chrome-results.json with eleven expected cases and zero failures, skips or flakes.

## Local deterministic checks

`pnpm check` covers strict TypeScript, 107 CPU tests, Rust formatting/clippy, 44 native Rust tests and 28 support entries. `pnpm ci:check` covers CI selection, documentation links, linear commit policy and support metadata. Their final logs and required PR check are retained with the task delivery record.

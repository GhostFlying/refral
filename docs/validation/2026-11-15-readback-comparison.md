# Canvas2D and GPU-worker readback comparison

Recorded on 2026-11-15 for task027 from main `8664c74` plus the comparison implementation. The accepted runtime/benchmark source inventory, browser command line and build hashes live with the raw results. Documentation is completed after capture. PR/current-head checks and integrated revision are recorded in `artifacts/readback-comparison/delivery.json`.

## Implementations and profile

The Canvas route runs the actual selected JS or Rust semantic core, ANGLE compiler and BrowserHost on Window. BrowserHost.captureCanvas ends the current pass and encodes each source RGBA8 texel into two opaque sRGB pixels on a private WebGPU OffscreenCanvas. A one-to-one Canvas2D drawImage/getImageData returns bytes synchronously. A decode creates an owned RGBA result. Per-tile submission/readback protects the reused offset uniform and canvas storage, and tiles obey the actual GPU dimension limit. Pipeline/bindings/canvases are reused and disposed with the host.

The worker route runs the same actual selected core and shader inputs on Window. Its existing private adapter snapshots ordered operations for a GPU worker running the same BrowserHost. That worker copies the target to a mapped Buffer and publishes completed bytes and sequence through shared memory. Window polls and takes an owned copy. The public GL facade and public readPixels validation are outside this experimental comparison. These traces invoke the common semantic-core interface with normalized inputs.

Both hosts use independent OffscreenCanvas surfaces. User-canvas cross-thread presentation remains worker integration work, so the reported worker timing covers its experimental surface. The worker reply arena currently holds at most 320x240 RGBA pixels. Larger tested tile dimensions use the Canvas route and a same-host map reference.

Both candidates observe earlier GPU work and return owned bytes synchronously in the tested capture profile. WebGPU mapping completion uses the device owner's content timeline. Canvas2D returns bitmap bytes synchronously, and transparent color conversions can lose information. Opaque byte encoding preserves the tested RGBA8 payload through the selected sRGB path. [WebGPU mapping](https://www.w3.org/TR/2026/CRD-webgpu-20260915/#dom-gpubuffer-mapasync), [HTML pixel reading](https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-getimagedata), [alpha conversion](https://html.spec.whatwg.org/multipage/canvas.html#premultiplied-alpha-and-the-2d-rendering-context)

## Correctness and regressions

`pnpm test:readback:compare` passes fourteen cases, comprising nine comparison cases and five existing CTS/demo/lifecycle cases. The actual-core corpus runs both routes and both cores on an isolated page, plus Canvas on an ordinary page. A separate headed Chrome launch removes Playwright's force-color-profile=srgb argument and repeats Canvas correctness through both cores. Native WebGL supplies the same byte-palette/state reference.

The corpus checks alternating draw uniforms, default and FBO targets, repeated reads, every alpha value, transparent nonzero RGB, channel extremes, odd 257x7 dimensions, nonzero input byteOffset and mutation after upload. It checks zero-initialized storage, draw/update/draw, retained output ownership, state after an invalid upload, FBO write-then-sample and deletion after an encoded draw. Tiling crosses the 4096-source-pixel seam with a 4099x1 source under the actual 8192 limit, then shrinks staging to 1x3. Map-based capture verifies those source bytes after Canvas capture. Empty capture is also checked. All 163 byte-checked image records, including retained-result rechecks, match explicit expectations. GPU diagnostics are collected after submitted-work completion.

Compared contexts use alpha=false, depth=true, stencil=false and single-sample targets. Exhaustive RGBA assertions use the texture FBO, while the default target's expected alpha is one. Native context attributes are retained in its reference record.

The existing feasibility command passes eleven cases. The complete Chrome suite passes 84 cases. Eleven selected original CTS files retain 243 assertions per native/JS/Rust backend. Build and dist verification pass the GPU probe, three-path RTT and triangles, ABI3/resource protocol2 and page-error checks. The local deterministic check passes strict TypeScript, 107 CPU tests, Rust formatting/clippy, 44 native Rust tests and 28 support entries.

## Measurement setup

The accepted run uses headed Chrome 157.0.8103.51, Apple M4 Max, arm64 Darwin 25.6.0 and hardware adapter apple/metal-3 with isFallbackAdapter=false. Both measured routes use the same cross-origin-isolated page and actual timer resolution near 0.005 ms. Ordinary-page Canvas correctness is recorded separately. The benchmark has its own Chrome profile, one GPU test worker and owned HMR-disabled servers. Browser/driver caches remain unmanaged and the Chrome process is retained across records.

Workloads have two uniform-colored draws and a scissored GL-row-zero marker. They capture 64x64 default, 320x240 default and 320x240 RGBA FBO images. FBO storage remains stable through warmup/measurement. This differs from the earlier feasibility trace's per-frame FBO reallocation. Red/green Float32Array inputs are prepared before sampling. Semantic processing, snapshots, Rust bridge work, host encoding/transport, GPU completion, image decoding and owned bytes are included in operation latency. Per-pixel assertions are outside sampling.

Each of three rounds rotates the four route/core combinations. Every record has thirty warmup samples, 120 measured samples and eight completed logical operations per sample. This gives 36 records, 4320 measured sample means and 34560 measured operations. Both routes yield through MessageChannel between sample groups, then await a completion/inspection checkpoint. Post-warm and post-measured live Buffer/Texture capacity counters match in every record.

Primary latency adds clientEncodingMs and completed capture roundTripMs. Inline encoding occurs before capture, and remote encoding occurs within capture. The raw capture-only phases therefore have route-specific boundaries. First operation and context/compiler/core preparation are recorded separately in each raw setup. Helper pipeline creation is lazy and contributes to the first operation. GPU-only duration is unmeasured in this comparison.

## Latency results

Each cell is pooled nearest-rank p50 / p95 in ms/operation across 360 sample means. Each sample is the average of eight completed operations, so the p95 describes sample means.

| Workload | Core | Canvas2D | GPU worker |
| --- | --- | --- | --- |
| default-64 | js | 0.4994 / 0.5619 | 0.4313 / 0.4938 |
| default-64 | rust | 0.6175 / 0.6919 | 0.5156 / 0.5731 |
| default-320 | js | 0.8175 / 0.9369 | 0.5062 / 0.5687 |
| default-320 | rust | 0.9663 / 1.1031 | 0.5925 / 0.6969 |
| fbo-320 | js | 0.7831 / 0.8994 | 0.4281 / 0.4987 |
| fbo-320 | rust | 0.8719 / 1.0394 | 0.5138 / 0.5969 |

The worker route has lower completed-operation latency in every measured combination. The current Canvas implementation adds an encoding pass, expanded opaque pixel data, native Canvas2D operations and CPU decoding. This result describes the tested lightweight trace and current implementations.

## Process CPU results

CPU values below are measured-batch means in ms/operation, normalized over 960 measured operations per record and averaged over three rounds. SystemInfo.getProcessInfo reports cumulative CPU seconds across all threads in each process. The runner retains before/after PID/type/counters, rejects process replacement/nonmonotonic or unavailable renderer counters, and sums all renderer processes including worker threads. GPU-process CPU is reported separately. The CPU window includes sample yields, timer/loop work, retirement draining, CDP bookkeeping and result serialization. Browser/network/storage process records are retained in raw data. [CDP ProcessInfo definition](https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/#type-ProcessInfo)

| Workload | Core | Canvas renderer CPU | Worker renderer CPU | Canvas GPU-process CPU | Worker GPU-process CPU |
| --- | --- | --- | --- | --- | --- |
| default-64 | js | 0.1373 | 0.5835 | 0.3701 | 0.2959 |
| default-64 | rust | 0.2790 | 0.6873 | 0.3897 | 0.3032 |
| default-320 | js | 0.4747 | 0.7243 | 0.3833 | 0.3299 |
| default-320 | rust | 0.6435 | 0.8555 | 0.4171 | 0.3360 |
| fbo-320 | js | 0.4941 | 0.6098 | 0.3478 | 0.2062 |
| fbo-320 | rust | 0.6241 | 0.7071 | 0.3512 | 0.2106 |

Canvas renderer CPU is lower in all paired workloads, while its GPU-process CPU is higher. The selected process sums depend on workload. The Canvas FBO renderer-plus-GPU process sums are approximately 0.8419 ms for JS and 0.9753 ms for Rust, compared with 0.8160 and 0.9177 ms for the worker route. These sums cover the selected process groups. Power and hardware GPU execution time require separate measurement. CPU accounting can exceed wall time when several process threads execute concurrently.

## Initialization and first operation

The following values are medians of the nine setup observations per route/core across three workloads and three rounds. Units are milliseconds. Initialization includes host/device, compiler/core and shader/resource setup after module import. Browser module/driver caches are retained. The first operation includes cold host pipeline creation and completed pixels.

| Route | Core | Initialization | First completed operation |
| --- | --- | --- | --- |
| canvas | js | 6.640 | 3.725 |
| canvas | rust | 4.740 | 3.450 |
| worker | js | 10.120 | 4.650 |
| worker | rust | 10.595 | 4.850 |

## Counters and capacity boundaries

Host counters track explicit WebGPU commands and resources. Canvas adds an explicit encode pass and a 16-byte parameter upload per tile. Its drawImage/getImageData calls can introduce browser-internal copies that the host copy counter cannot observe. Worker capture records an explicit texture-to-buffer copy. The Canvas helper's imageBytes and decodedBytes describe returned byte volumes, and stagingBytes estimates two canvas bitmap capacities. Returned ImageData, owned output arrays, swapchains, snapshots, driver allocations and whole language heaps require their own memory accounting. Raw live/peak host counters and helper counts remain in every record.

## Integration recommendation and remaining acceptance

The original worker-only recommendation was based on incomplete candidate exploration. Both candidates now have executable actual-core evidence. For Chrome-first public integration, Canvas2D offers ordinary-page deployment and lower renderer CPU in this trace, while the worker candidate offers lower measured completion latency with shared-memory deployment and polling costs. A Canvas-first integration is a reasonable next task for compatibility-oriented readback. Frequent latency-sensitive readback can evaluate the worker backend using the same shared semantic contract.

This task delivers experimental host capture and a reproducible comparison. Public readPixels argument/error ordering, destination views/PACK_ALIGNMENT, arbitrary regions/zero-fill, context loss and original pixel-CTS branding remain production implementation acceptance. The existing support matrix continues to list public readPixels as unimplemented. The two deferred originals program-handling and feedback-loop remain next acceptance candidates after that integration.

## Reproduction and evidence

Run pnpm test:readback:compare for correctness, pnpm bench:readback independently for performance, pnpm test:readback for the earlier primitives/worker regressions and pnpm test:chrome for the full browser baseline. pnpm check and pnpm ci:check cover deterministic checks and policy. pnpm build followed by pnpm test:dist verifies deployment.

Raw correctness records, natural-color launch evidence, screenshots/traces on failure and benchmark records live under artifacts/readback-comparison. The accepted benchmark summary and source inventory are under its benchmark directory. Preliminary captures are retained in separately named sibling directories. Logs are artifacts/readback-comparison-correctness.log, readback-comparison-benchmark.log, readback-comparison-worker-regression.log, readback-comparison-chrome.log, readback-comparison-check.log, readback-comparison-build.log and readback-comparison-dist.log. Task027 records scope, independent review and final delivery.

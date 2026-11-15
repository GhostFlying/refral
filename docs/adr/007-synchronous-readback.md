# ADR 007 — Synchronous readback feasibility

Status is accepted on 2026-11-15. The user selected Canvas2D for the first public synchronous readPixels implementation after task025 and task027 compared the available paths.

## Evidence and constraints

WebGPU exposes mapAsync and mapped-range access through its content timeline. HTML allows potentially blocking Atomics operations in worker agents. Shared buffer serialization requires a cross-origin-isolated agent cluster. [WebGPU mapping](https://www.w3.org/TR/2026/CRD-webgpu-20260915/#dom-gpubuffer-mapasync), [HTML agents](https://html.spec.whatwg.org/multipage/webappapis.html#agents-and-agent-clusters), [shared serialization](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal)

The current Chrome experiment observes pending mapping and a blocked completion callback during one Window task. Accessing its mapped range throws OperationError until the task yields. Ordinary responses expose no SharedArrayBuffer constructor. COOP/COEP responses expose shared memory, while Window Atomics.wait throws TypeError. These observations are recorded directly in `artifacts/readback/window-false.json` and `window-true.json`.

Both actual semantic cores execute on Window with a GPU worker, returning fresh default/FBO pixels synchronously through a shared result and polling. Both also execute on a caller worker using Atomics.wait against an independent GPU worker. Timer observations record the caller's blocked event loop and continuing Window timers in the worker-client placement. The experiment uses independent OffscreenCanvas storage.

A worker that blocks while owning the pending GPU map also leaves its completion callback pending until its wait times out and the task yields. The GPU callback owner therefore needs an independently progressing event loop in the tested arrangement. Ordinary-page cloning of a Wasm-created shared buffer also produces DataCloneError, recording the shared-memory serialization constraint directly.

## Accepted integration

The selected caller core owns semantic state, validation and current-target/packing plans. The facade owns WebIDL conversion and the caller's destination view. BrowserHost supplies completed owned RGBA8 bytes through the Canvas2D capture boundary. Both actual JS and Rust cores implement the same public profile.

GPU execution remains on the caller thread. A private WebGPU canvas encodes each RGBA8 texel into two opaque sRGB pixels. Canvas2D drawImage/getImageData synchronously returns their bytes, which are decoded into an independent result. Tiling respects the actual GPU dimension limit. Opaque encoding preserves source alpha independently from canvas alpha conversion. The public path runs on an ordinary Chrome page. [HTML pixel reading](https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-getimagedata), [alpha conversion](https://html.spec.whatwg.org/multipage/canvas.html#premultiplied-alpha-and-the-2d-rendering-context)

The public factory remains asynchronous and its supported GL methods remain synchronous. RGBA/UNSIGNED_BYTE reads accept fixed Uint8Array and Uint8ClampedArray views. The facade writes only the framebuffer intersection into the validated PACK_ALIGNMENT layout. It preserves bytes outside the framebuffer, row padding and unrelated destination storage. Empty reads perform semantic validation without capture work. Readback completes pending writes before returning and subsequent draws retain their ordinary ordering.

Rust retains ABI3/resource-protocol2 and adds readback capability v1. Its bounded owned reply carries the target, clipped rectangle, destination offset, stride and required byte span. Caller memory remains in the facade. Missing capabilities fail initialization with rebuild guidance.

The worker candidate transports immutable ordered host operations with complete resource identity and versions. After flushing those operations, it publishes readback bytes and completion sequence into bounded shared storage. The caller takes an owned result copy before that storage is reused.

The experimental worker-backed Window placement uses polling during a synchronous read. Its worker caller placement uses Atomics.wait, with GPU callbacks owned by a separate worker. Deployment of those shared-reply experiments requires secure context and cross-origin isolation. Any later integration of that backend needs explicit capability detection and documented initialization behavior.

## Verification and remaining scope

Task028 accepts the public profile through shared specification-derived cases, original program-handling, feedback-loop and read-pixels-pack-alignment scripts, existing rendering regressions and built deployment verification. The CTS adapter assigns the facade the native WebGLRenderingContext prototype of the helper iframe. It preserves inert head shader elements and runs original scripts and assertions unchanged. Branding is scoped to the harness.

Task027's [comparison report](../validation/2026-11-15-readback-comparison.md) records matched actual-core correctness, repeated latency and process CPU evidence for both candidates. Task028 records public-entry behavior and completed clear/read latency in the [public readPixels report](../validation/2026-11-16-public-readpixels.md). The selected Canvas path has synchronous Canvas2D transfer and packing costs. The measured Chrome/hardware configuration bounds the current verification.

The independent worker experiment remains available for later deployment and execution-placement evaluation. Context restoration and additional readback formats retain their compatibility tasks. General GPU completion APIs have independent contracts and support entries.

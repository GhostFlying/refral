# ADR 007 — Synchronous readback feasibility

Status is proposed on 2026-11-15 after task025's Chrome experiment.

## Evidence and constraints

WebGPU exposes mapAsync and mapped-range access through its content timeline. HTML allows potentially blocking Atomics operations in worker agents. Shared buffer serialization requires a cross-origin-isolated agent cluster. [WebGPU mapping](https://www.w3.org/TR/2026/CRD-webgpu-20260915/#dom-gpubuffer-mapasync), [HTML agents](https://html.spec.whatwg.org/multipage/webappapis.html#agents-and-agent-clusters), [shared serialization](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal)

The current Chrome experiment observes pending mapping and a blocked completion callback during one Window task. Accessing its mapped range throws OperationError until the task yields. Ordinary responses expose no SharedArrayBuffer constructor. COOP/COEP responses expose shared memory, while Window Atomics.wait throws TypeError. These observations are recorded directly in `artifacts/readback/window-false.json` and `window-true.json`.

Both actual semantic cores execute on Window with a GPU worker, returning fresh default/FBO pixels synchronously through a shared result and polling. Both also execute on a caller worker using Atomics.wait against an independent GPU worker. Timer observations record the caller's blocked event loop and continuing Window timers in the worker-client placement. The experiment uses independent OffscreenCanvas storage.

A worker that blocks while owning the pending GPU map also leaves its completion callback pending until its wait times out and the task yields. The GPU callback owner therefore needs an independently progressing event loop in the tested arrangement. Ordinary-page cloning of a Wasm-created shared buffer also produces DataCloneError, recording the shared-memory serialization constraint directly.

## Proposed integration

Make GPU execution worker-owned for a synchronous readback backend. The selected caller core owns semantic state, validation, wrapper identity and synchronous compiler/query behavior. Transport immutable ordered host operations with complete resource identity and versions. After flushing those operations, publish readback bytes and completion sequence into bounded shared storage. Take an owned result copy before that storage is reused.

The Window API placement requires polling during a synchronous read. A worker API placement can use Atomics.wait, with GPU callbacks owned by a separate worker. Deployment of the tested shared-reply paths requires secure context and cross-origin isolation. Any production mode needs explicit capability detection and a documented initialization result when those conditions are unavailable.

## Integration work and decision boundary

The experiment establishes feasibility for fresh RGBA8 images from a bounded trace. Production support needs the public readPixels overload/validation order, destination views, clipping, PACK_ALIGNMENT, current-target state, error and device-loss propagation, ordering and retirement, and presentation/resize behavior for the user-owned canvas. The current concrete BrowserHost dependency in the facade/testing hooks also needs an adapter contract.

Window polling consumes CPU while waiting and blocks that caller's event loop. The raw timings include GPU completion and copying. Broader traces and failure policies need their own acceptance before selecting production defaults. The independent worker canvas in this experiment leaves user-canvas presentation integration as a concrete follow-up.

Original pixel CTS helpers additionally inspect the iframe realm's native WebGL context brand. The CTS adapter needs an explicit recorded solution alongside synchronous reads. Task026 maps the exact files and helper paths. The nearest original candidates after these dependencies are implemented are program-handling.html and feedback-loop.html.

The production support matrix continues to describe the existing public context. Task025 records experimental results and the first-stage implementation proposal. The next task should select the deployment/API placement, define the production host contract, then implement and accept the shared readPixels profile through both cores.

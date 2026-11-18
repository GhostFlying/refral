# Window-thread OffscreenCanvas WebGL1 contexts

## Goal and scope

Allow a Window to pass a dynamically created OffscreenCanvas to the existing asynchronous WebGL1 factory with either selected core. The canvas remains the context's canvas, the host owns its WebGPU presentation surface, and using the canvas as a texture source flushes its actual drawing buffer. The original CTS can obtain this same context synchronously because its parent prepares the device, compiler and selected core before starting the unmodified test.

Dependencies are task 053, the existing prepared factory and registered canvas-source upload path. This task owns the facade canvas input types, shared same-thread conformance acquisition, surface provenance, dedicated regressions and the corresponding spec/adapter documentation. Workers require their own realm initialization. Context loss, restoration, image bitmap transfer, default-buffer discard and optional legacy commit remain independently observable.

## Implementation and acceptance

1. Follow the WebGL1 canvas ownership and drawing-buffer rules and the HTML OffscreenCanvas context-mode rules. Validate receiver brands, synchronous context identity, competing modes and actual backend on both HTML and OffscreenCanvas.
2. Reuse the prepared factory on the official runner bridge. Record canvas type and actual core for each acquired context. Preserve original scripts, assertions, Worker diagnostics and capability branches.
3. Run `pnpm typecheck`, `pnpm test:unit`, and the adapter's Node tests. In the exclusive headless Chrome window, exercise public JS and Rust OffscreenCanvas drawing and the registered texture source. Run the three original backends for `^conformance/offscreencanvas/(context-creation|offscreencanvas-resize)\.html$` and `^conformance/textures/webgl_canvas/` and inspect counts, diagnostics and provenance. Broader context-method/worker/presentation outcomes remain separately tracked.

## Execution

Planned on main at 6dff15c. The shared host already accepts both canvas types. The public and prepared factory types limit inputs to HTMLCanvasElement, and the current official adapter actively rejects same-thread OffscreenCanvas WebGL requests.

The public JS and Rust OffscreenCanvas tests both passed. Each used two independent contexts and verified that the destination retained the uploaded green pixels after a second source clear produced red. TypeScript, 226 Vitest tests, 62 Node tool tests and the release build passed.

Headless Chrome completed all ten original files on all three backends. Each backend executed 9,876 successful assertions and zero failures. All thirty records have case-page screenshots and all eight texture files per backend report real HTML and OffscreenCanvas contexts with the requested core. The old optional `commit()` probe in the resize original returns early on Chrome; the two assertions there establish the feature-probe and script completion. Full records, screenshots, GPU adapter data and public test log are in `artifacts/conformance/campaign/window-offscreen/`.

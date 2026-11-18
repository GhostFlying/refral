# Keep default framebuffer contents across equal-size canvas assignments

Baseline main 3531eab. The unchanged WebGL1.0.4 original 41, conformance/canvas/render-after-resize-test.html, exercises a quad immediately after actual resizes and after assigning canvas.width to its current value. The last three groups cover depth rejection, stencil rejection and a scissored color write.

## Scope and plan

Reproduce the original on native Chrome, Refral JS and actual Rust/Wasm with screenshots, then compare a visible HTML canvas's public WebGPU texture generation and canonical color before and after an equal-size assignment within one JS call stack. Check actual resize initialization, drawingBufferWidth/Height, unchanged viewport, subsequent composition and the hidden/detached controls. Identify the first operation that loses semantic attachments. If the shared host treats WebGPU reconfiguration as compositor consumption, decouple the two while preserving true nonpreserved-buffer discard. Reuse existing GL state in each core. Owned files are the common browser host, a Chrome regression, this record and the spec map.

The pinned WebGL drawing-buffer and viewport sections define initial attachments and prohibit viewport changes on resize. The original requires equal dimensions to preserve existing color, depth and stencil. Preserve assertions, native behavior and the selected core. Run pnpm check and the focused headless lifecycle/regression tests. Run the official three paths for render-after-resize, zero-sized/drawingbuffer, buffer-preserve, context-attribute-preserve-drawing-buffer and bitmap transfer where affected. Store raw results and diagnostics in artifacts/conformance/campaign/render-after-resize.

## Implementation and evidence

The first three real-resize groups of original 41 already passed. Assigning canvas.width its current value replaced the public WebGPU texture within the same JS stack. The HTML compositor check then discarded the canonical framebuffer. The blue depth and stencil draws incorrectly succeeded; the pixel outside the scissor was transparent. The three original outcomes before the change were 11/0 native, 8/3 JS, and 8/3 Rust.

BrowserHost observes the HTML width and height attributes and drains pending mutation records synchronously at default-target use. Old attribute values distinguish an actual size transition, including a change and a return to the original size, from an equal numeric dimension. A detached scratch canvas supplies the platform's dimension parsing when the attribute spelling changes. Within the same document animation frame, an equal-size mutation republishes the canonical attachments. Explicitly retained, hidden and detached surfaces keep their contents across frames. The existing visibility and WebGPU texture comparison continue to detect observed composition on a visible nonpreserved canvas. Both cores retain their viewport and error state.

Headless Chrome 158.0.8127.36, Apple Metal 3 hardware, DPR 1, one GPU worker. The final official records contain 24 screenshots, one per file and backend. Each result contains its actual core. Compiler Wasm SHA-256 is 70c16657373e9265ed7dc6a40cfc70eac0f96b2055d9c66cbef283c756950c06 and Rust Wasm SHA-256 is e6095830f652136494b8ca6fa851f8de58a9e027a178e2b48bf6547a7e4057b1.

| Original | Native passed/failed | JS passed/failed | Rust passed/failed |
| --- | --- | --- | --- |
| 29 buffer-offscreen-test | 9/0 | 9/0 | 9/0 |
| 30 buffer-preserve-test | 29/0 | 29/0 | 29/0 |
| 35 drawingbuffer-test | 30/0 | 30/0 | 30/0 |
| 41 render-after-resize-test | 11/0 | 11/0 | 11/0 |
| 48 context/context-attribute-preserve-drawing-buffer | 4/0 | 3/1 | 3/1 |
| 67 zero-sized-canvas | 10/0 | 10/0 | 10/0 |
| 599 offscreencanvas/context-attribute-preserve-drawing-buffer | 3/0 | 3/0 | 3/0 |
| 610 offscreencanvas-transfer-image-bitmap | 241/0 | 241/0 | 241/0 |

The hardware fixture samples visible, hidden and detached HTML canvases across all three backends. Immediate GL observations after equal width and height retain green. A real 3×3 to 5×3 resize and 5→6→5 width assignments without intervening GL calls both initialize transparent black. The explicit viewport [1,0,2,2] survives. A microtask after equal height retains red in direct Canvas2D and GL observations. After two animation frames, a subsequent equal-size write and GL read return transparent on visible canvases and red on hidden and detached canvases. All nine scenes had zero GL errors and empty GPU validation errors.

### Remaining immediate Canvas2D observation

A same-stack Canvas2D drawImage immediately following a final equal-size width assignment is a known gap. On the visible, hidden and detached canvases the native source supplied [0,255,0,255] and both Refral sources supplied [0,0,0,0]. The trace issues no intervening or subsequent GL operation on the source. The web platform can synchronously replace the externally observable WebGPU bitmap before mutation delivery. The next default-target GL access or the mutation observer's microtask can republish the canonical image. The trace verifies green for a Canvas2D copy after that GL access and red following microtask delivery. This same-stack requirement remains open independently of the accepted post-composite observation in original 48. Future HTML presentation work should re-run this exact DOM-only control. A complete solution must also support attribute changes through DOM APIs and maintain canvas object semantics.

### Reproduction

Run pnpm check, REFRAL_HEADLESS=1 pnpm test:chrome canvas-resize.spec.ts lifecycle.spec.ts, and use the following selector with pnpm conformance:run for each backend, --screenshots and --timeout-ms 5000.

```text
/(render-after-resize-test|zero-sized-canvas|drawingbuffer-test|buffer-offscreen-test|buffer-preserve-test|context-attribute-preserve-drawing-buffer|offscreencanvas-transfer-image-bitmap)\.html$
```

The deterministic suite passed 243 TypeScript and 76 native Rust tests and validated 47 support entries. The Chrome regression and four lifecycle tests passed. The project fixture writes artifacts/resize/attachment-observation.json. Central raw results, the nine-scene matrix, screenshots and before/after logs are under artifacts/conformance/campaign/render-after-resize.

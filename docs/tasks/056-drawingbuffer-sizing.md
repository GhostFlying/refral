# Guard the WebGPU presentation size at context creation

## Goal and evidence

The pinned WebGL drawing-buffer rules clamp zero dimensions to one and permit a smaller drawing buffer when the requested size is unavailable. The shared browser host already exposes that bounded surface to both cores. During task 052 both cores completed all 30 assertions of `conformance/canvas/drawingbuffer-test.html` and all 10 assertions of `conformance/context/zero-sized-canvas.html`. WebGPU reported 8224×8 on an 8192-limited device and 0×0 respectively. The public canvas initially requested those sizes. [Pinned WebGL drawing-buffer rules](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#THE_DRAWING_BUFFER)

## Plan

- Own the presentation setup in `packages/browser-host/src/index.ts` and a focused browser regression. Preserve the canvas attributes, synchronous GL drawing-buffer queries, viewport state and the canonical bounded render target.
- Configure a supported swapchain eagerly. When the initial canvas size cannot back a swapchain, defer configuration until an eligible presentation after a resize.
- Use the existing headless originals for the initial invalid sizes and viewport behavior. Exercise the size transition to a valid presentation surface in both cores, observing submitted pixels and validation errors.
- Verify type checking and deterministic checks. The integrating agent owns the exclusive GPU window.

## Acceptance

```sh
pnpm typecheck
REFRAL_HEADLESS=1 pnpm test:chrome lifecycle.spec.ts -g 'presentation after resizing'
REFRAL_HEADLESS=1 pnpm conformance:run --backend all --include '^conformance/(canvas/drawingbuffer-test|context/zero-sized-canvas)\.html$' --screenshots --timeout-ms 5000 --output artifacts/conformance/campaign/drawingbuffer-sizing
```

## Implementation evidence

Chrome passes the canvas's requested width and height into Dawn descriptor validation inside `GPUCanvasContext.configure`. A guard only around `getCurrentTexture` leaves the original failure at initialization. The host now checks the requested dimensions against its bounded GL surface before configuring or acquiring a presentation texture. A resize into range allows the next present to configure the canvas. [Chromium canvas implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/webgpu/gpu_canvas_context.cc)

TypeScript and all 226 deterministic Vitest cases passed in the task worktree. The dedicated resize/readback/presentation test passed on JS and Rust in a single headless Chrome run. The two originals passed on native, JS and Rust: 30 and 10 successful assertions respectively per backend, zero failures, six case-page screenshots, and zero GPU validation errors. Each result records the actual selected core. Raw records and the resize log are in `artifacts/conformance/campaign/drawingbuffer-sizing/`.

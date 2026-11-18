# WebGL1 stencil raster state and default framebuffer

Build on task 047. This task owns WebIDL conversion, context attributes, both cores' stencil raster state and validation, the Wasm snapshot and BrowserHost pipeline encoding.

1. Support enabled state, front/back stencil mask, function, reference and operations, and clearStencil. Preserve state and getters across target switching. Reject inconsistent effective face state at draw only when testing is enabled and the target has stencil.
2. Enable a stencil default framebuffer on request, including stencil-only contexts. Encode face comparisons/operations and masked/scissored clear from the call's raster snapshot. Initialize new stencil storage to zero and retain it across pass breaks.
   The large viewport original requests a canvas larger than the device can allocate. Bound the actual drawing buffer to the device limit and share the actual size with the facade, both cores and capture. Skip the oversized WebGPU canvas swapchain while retaining the bounded drawing buffer for drawing and reads.
3. Run webgl-specific-stencil-settings, stencil-renderbuffer-initialization, rendering-stencil-large-viewport, context-attributes-alpha-depth-stencil-antialias and depth-renderbuffer-initialization. Add exact masked clear and face-state differential tests. Run deterministic, Wasm, headless browser and deployment gates before rebase merge.

## Acceptance

Both cores track independent front/back values and validate effective references and masks when the draw target has stencil. The host uses WebGPU face operations and a render pass with the front write mask for masked/scissored clear. ABI5 extends the raster snapshot for both draw and clear, retaining resource capability 7. The new three-path stencil scene matches exact pixels before and after asymmetric scissored clear and stencil increment.

Nine targeted originals passed on all backends. Both cores pass all 671 webgl-specific-stencil-settings assertions, all 43 stencil initialization assertions, all 43 depth initialization assertions and all eight large viewport assertions. The context attributes file passed 525 assertions per Refral core and 533 native assertions, with the runtime reporting antialias false. In the oversized canvas case the canonical 8192×8192 drawing buffer supports the requested pixels on this Chrome device. The presentation swapchain remains bounded by the original canvas size and device limit. Raw results are under `artifacts/stencil-raster/official-final`.

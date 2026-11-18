# WebGL1 stencil raster state and default framebuffer

Build on task 047. This task owns WebIDL conversion, context attributes, both cores' stencil raster state and validation, the Wasm snapshot and BrowserHost pipeline encoding.

1. Support enabled state, front/back stencil mask, function, reference and operations, and clearStencil. Preserve state and getters across target switching. Reject inconsistent effective face state at draw only when testing is enabled and the target has stencil.
2. Enable a stencil default framebuffer on request, including stencil-only contexts. Encode face comparisons/operations and masked/scissored clear from the call's raster snapshot. Initialize new stencil storage to zero and retain it across pass breaks.
3. Run webgl-specific-stencil-settings, stencil-renderbuffer-initialization, rendering-stencil-large-viewport, context-attributes-alpha-depth-stencil-antialias and depth-renderbuffer-initialization. Add exact masked clear and face-state differential tests. Run deterministic, Wasm, headless browser and deployment gates before rebase merge.

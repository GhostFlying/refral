# WebGL1 stencil framebuffer attachments

Build on task 046's renderbuffer generations, target snapshots and GPU retirement. This task owns both cores' framebuffer state, resource target transport, BrowserHost target handling and framebuffer verification.

1. Add independent STENCIL_ATTACHMENT and DEPTH_STENCIL_ATTACHMENT reference slots and validate them alongside DEPTH_ATTACHMENT. Implement STENCIL_INDEX8 and DEPTH_STENCIL allocation, queries, resize and retained deletion. Reject conflicting attachment sets at framebuffer validation.
2. Carry one validated depth/stencil allocation in a complete target. Use stencil8, depth24plus or depth24plus-stencil8 as appropriate. Initialize and preserve each aspect independently across pass breaks. Keep the existing depth clear and draw behavior with packed storage.
   The original test also draws with the unchanged canvas viewport against a smaller FBO. Preserve the viewport through WebGPU within its supported coordinate range and skip empty framebuffer intersections.
3. Run the pinned framebuffer-object-attachment, framebuffer-state-restoration, framebuffer-test and texture copy originals in headless Chrome. Add shared validation for packed targets, replacement, conflicting states and read/copy/draw rejection. Run pnpm check, pnpm rust:build, pnpm rust:test:wasm and production deployment. Record support and deliver through required CI.

## Acceptance

Resource capability 7 identifies the auxiliary target format with the same handle and storage generation. Logical attachment slots remain independent, so deleting or detaching a conflicting attachment restores the prior valid target. Packed depth/stencil uses one GPU allocation and stencil-only uses a stencil8 allocation. Color and depth clears preserve the stencil aspect.

All eight targeted original files passed in headless Chrome. The framebuffer-object-attachment result is 573 native assertions and 569 per Refral core. The original conditionally exercises reads from complete depth-only targets, which remain outside the declared target combinations. The shared fbo-stencil-attachments scene renders with a negative and oversized viewport, rejects an attachment conflict, verifies read destination ownership and preserves the packed depth result when the conflicting attachment is deleted. Results are under `artifacts/stencil-attachments/official-final` and `artifacts/rtt/fbo-stencil-attachments`.

The attachment revision also passed the full 136-case headless suite, the deterministic checks, 47 actual-Wasm tests and built deployment with ABI4/resource7/readback1/DOM2.

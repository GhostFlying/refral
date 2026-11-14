# JS render-to-texture semantics and resource handles

Status is running.

## Goal and ownership

Implement the JS work in task 020 following ADR 006. This task owns `packages/core-js/**` and this record. The integrating agent owns the common resource registry/contracts, facade, executor, shared fixtures, and delivery.

## PR1 plan

1. Add typed texture/renderbuffer/framebuffer adaptation to DrawingCore, including binding, attachment-name queries, deletion, and retained attachment lifetimes.
2. Connect the semantic context to the per-context ResourceRegistry while preserving optional direct construction for existing CPU tests.
3. Publish owned texture define/update data and final retirement in GL order, use canonical execution records, and advance texture content versions for GPU color writes without uploading again.
4. Use registry depth identities with independent storage generations and preserve the existing JS demo paths.
5. Run TypeScript and deterministic CPU regressions, then hand PR1 files to integration before further semantic edits.

## Subsequent semantic plan

Audit each supported behavior against the pinned specification before changing it. Complete uniform array/excess-count, integer/bool/matrix/sampler behavior, five-format unpack/null/subimage/completeness, raster state, and bound/unbound FBO attachment/deletion/storage behavior. Coordinate later edits in the same files with the integrating agent's staged PR boundaries.

## Acceptance

No private texture/renderbuffer/framebuffer class crosses the public DrawingCore boundary. Draw and target records use canonical shared resources. Earlier encoded work retains previous records while later operations observe current versions. Existing JS tests and demo behavior pass through the integrating agent's real Chrome acceptance, with detailed semantic outcomes and remaining scope recorded here.

## PR1 implementation and handoff

DrawingCore now adapts texture/renderbuffer/framebuffer creation, binding, deletion, object checks, binding queries, and framebuffer attachment-name queries with typed context/slot/generation handles. Texture and depth attachment identities remain available while an unbound framebuffer retains a deleted resource, and final release retires both the execution resource and logical slot.

The semantic context accepts optional ResourceRegistry integration after the existing constructor arguments. The public DrawingCore supplies it. Texture definitions and subimage updates publish owned RGBA bytes in GL order and use the registry's canonical storage. Renderbuffer targets resolve a neutral depth ID with independent storage generation. Color clear/draw operations advance content version through `write-texture`, preserving the canonical rendered allocation. A depth-only or fully color-masked clear preserves the color content version.

The new PixelUpload record carries the facade's normalized byte view and intrinsic source type into pixel validation. Existing raw ArrayBufferView inputs remain available to direct internal construction used by CPU regressions.

`pnpm test:unit` passed 12 files and 75 tests at PR1 handoff. Four new resource tests cover typed binding/attachment identity, owned define/update/reallocation payloads, GPU-write alias transitions followed by subimage update, and retained deletion/final retirement/slot reuse. The host and compiler are mocks with the real shared ExecutionResources and compiler registry implementations.

The initial TypeScript run reported only the Rust integration test's in-progress missing required resources service. The integrating agent and Rust worker own that update and final repository verification. Further JS semantic edits wait until integration snapshots the PR1 files.

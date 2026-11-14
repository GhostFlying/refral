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

The initial TypeScript run reported only the Rust integration test's in-progress missing required resources service. TypeScript subsequently passed. Integration committed the PR1 boundary before the later semantic edits.

## PR2 uniform and raster plan

GLES 2.0.25 section 2.10.4 ignores excess complete uniform array elements and rejects multiple values for a non-array uniform. Array stride distinguishes reflected arrays of length one. Boolean conversion compares the numeric input to zero. Section 2.12.1 clamps viewport dimensions to their advertised maximums, and table 4.2 excludes SRC_ALPHA_SATURATE from destination blend factors. Implement these corrections and verify array/matrix packing, exact i32 values, boolean/non-current queries, sampler units, viewport/scissor state, and blend error atomicity. [OpenGL ES 2.0.25](https://registry.khronos.org/OpenGL/specs/es/2.0/es_full_spec_2.0.pdf)

The pinned WebGL constant-color rule limits the constant color/alpha conflict check to the RGB source/destination pair. Preserve that behavior while correcting destination-factor validation. [Pinned WebGL constant-color rule](https://raw.githubusercontent.com/KhronosGroup/WebGL/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#CONSTANT_COLOR_BLEND)

## PR2 implementation and handoff

Uniform updates now consume only the remaining active array elements while accepting complete excess input. Reflected array stride preserves array-of-length-one behavior and `[0]` active names. Boolean float updates use numeric zero comparison, including NaN as nonzero. Existing exact i32 storage, scalar sampler range/type validation, non-current uniform queries, and matrix column/array-stride packing pass focused regressions.

Viewport dimensions clamp to the advertised limit. Destination RGB/alpha saturation factors report INVALID_ENUM before changing blend state. Source saturation and the RGB-only constant-color conflict rule retain their specified behavior. Clear snapshots preserve the raster values observed at the call.

Seven uniform and four raster tests were added. `pnpm test:unit` passed 14 files and 86 tests. The latest TypeScript invocation reported only the integrating agent's in-progress Rust example backend union in `examples/main.ts`. This task's files had no type errors. Texture/FBO semantic changes remain for the following boundary.

# JS render-to-texture semantics and resource handles

Status is implemented, with task 020 owning integration and three-path acceptance.

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

## PR3 texture plan

The pinned WebGL TEXIMAGE2D/TEXSUBIMAGE2D and pixel-storage sections require five-format UNSIGNED_BYTE source validation, row alignment, synchronous source consumption, flip/premultiply handling, zero initialization, and INVALID_VALUE for null subimages. Preserve data and versions after rejected calls and valid empty subimage updates. Track first successful texture binding for object checks. GLES texture completeness requires only level zero for a 1x1 mip chain. Add focused CPU coverage before handing this boundary to integration. [Pinned WebGL texture specification](https://raw.githubusercontent.com/KhronosGroup/WebGL/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#TEXSUBIMAGE2D)

## PR3 implementation and handoff

Null subimages now return INVALID_VALUE after normal argument validation. Negative subimage levels, invalid format enums, bounds, source brand, and short input rows preserve prior storage and versions when rejected. Valid zero-area subimage updates validate their inputs and preserve storage/version state. Pixel allocation failure reports OUT_OF_MEMORY without replacing prior data.

Texture object checks track the first successful binding. A 1x1 image is complete with a mipmap filter because it requires only level zero. Larger images retain the declared level-zero completeness limits.

Thirteen texture cases cover all five normalized formats and null initialization, source subviews/row padding, flip/premultiply, input failure atomicity, valid empty updates, NPOT parameters, 1x1 completeness, first binding, and simulated allocation failure. `pnpm exec vitest run --exclude packages/core-js/src/framebuffers.test.ts` passed 15 files and 99 tests. The excluded file contains future phase-4 assertions and is outside this PR boundary. `pnpm typecheck` passed. FBO corrections remain held for the next integration snapshot.

## PR4 framebuffer plan

GLES object creation and framebuffer rules require first successful binding, initialized attachment objects, distinct missing/undefined/dimension statuses, and query validation by attachment type. The native probe in `artifacts/rtt/native-attachment-queries.json` confirms INVALID_ENUM for non-type queries on empty attachments and texture-specific queries on renderbuffers. Preserve bound/unbound references across deletion and repeated deletion. Initialize renderbuffer query state to RGBA4 and zero bits before allocation, and distinguish invalid storage enums from valid unsupported formats. Add focused state/lifetime regressions within the declared RGBA color and optional depth target profile.

## PR4 implementation and final handoff

Framebuffer and renderbuffer object checks now track the first successful binding. Never-bound texture/renderbuffer names cannot become attachments. An attached RGBA texture without an image reports FRAMEBUFFER_INCOMPLETE_ATTACHMENT, separately from a missing attachment and mismatched depth dimensions.

Attachment query validation follows the attached object type and the native probe. Empty attachments expose NONE for OBJECT_TYPE and reject other queries. Renderbuffer attachments reject texture-specific queries. Texture attachment-name results retain their original logical identity while unbound framebuffers hold a deleted texture.

Repeated renderbuffer deletion now returns before attachment cleanup. This fixes the case where an initial deletion detaches the bound framebuffer, then a repeated deletion after binding another retaining framebuffer incorrectly removed that second reference. Shared unbound references keep texture/depth storage alive until the final attachment is released, then retirement occurs once.

Renderbuffer query defaults now report RGBA4 and zero depth bits before storage allocation. Invalid storage format enums report INVALID_ENUM. Valid color/stencil storage formats continue through the declared unsupported-profile diagnostic. The implemented depth backing reports 24 bits for DEPTH_COMPONENT16 storage, satisfying its minimum precision with the shared depth24plus host allocation.

Seven framebuffer cases cover first binding, never-bound attachment rejection, default query state and invalid/unsupported storage atomicity, attachment completeness, native-confirmed query errors, and multi-framebuffer deletion/lifetime. The final `pnpm test:unit` passed 16 files and 106 tests. `pnpm typecheck` passed. Existing direct SemanticContext construction and all earlier deterministic regressions remain covered. The integrating agent owns actual Chrome/CTS/demo/performance/deployment acceptance for the final task.

During integration, JS completeness was aligned with Rust's declared RGBA execution profile. Depth-only and RGB color targets return FRAMEBUFFER_UNSUPPORTED after image and dimension validation. Truly empty targets retain MISSING_ATTACHMENT. Component-bit queries now follow the currently bound framebuffer, including alpha on an opaque default context and depth removal. An eighth framebuffer CPU case covers these queries, bringing the deterministic suite to 107 tests. The shared depth-render/sample scene also checks alpha bits, minimum depth precision and depth deletion.

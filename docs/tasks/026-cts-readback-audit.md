# CTS readback and input dependency audit

Status is complete as a source audit on 2026-11-15.

## Ownership and goal

The verification worker owns this record and docs/references/cts-readback-dependencies.md. Audit the pinned deferred CTS sources and the next DOM texture-input sources. Identify their actual synchronous GPU-dependent calls, other prerequisites, helper dependencies and current JS/Rust coverage. Give concrete next implementation/test slices for task025.

## Steps and acceptance

Read unmodified pinned sources and helpers, trace readPixels/finish and texture/renderbuffer/image API use, and record upstream paths and relevant functions. Preserve original assertions and identities. Keep source acquisition or runtime/test changes out of this audit. Return a concise findings table and source links. The integrating agent owns shared manifests, roadmap, support metadata and Git delivery.

## Audit plan

1. Read all five deferred original HTML files and resolve the helper functions used for pixel checks, error checks, shader setup and image loading at CTS revision `39443210f7f81db4773eb104facadfb85d05dfa4`.
2. Trace the framebuffer bound at each GPU-dependent read/copy and distinguish explicit readPixels/finish calls from helper-mediated calls. Record exact WebGL1 branches and optional WebGL2 branches.
3. Compare prerequisites against the current support profile and shared fixtures. Correct the earlier lock-file summaries in this report and send integration the precise manifest changes.
4. Inspect bounded next state/query and DOM-source candidates at the same revision. Give exact test paths, entry/helper functions, dependencies and source links, with runnable candidates conditional on a real unchanged-assertion run.
5. Check documentation links, source references and internal consistency. Report this as a read-only source audit, with browser execution and implementation feasibility owned by task025.

## Findings and handoff

The completed [dependency reference](../references/cts-readback-dependencies.md) traces all five deferred originals and their pixel/error/draw helpers. They consume synchronous readPixels results, with no gl.finish call in those paths. Program-handling reads the default buffer, while feedback-loop reads both the default buffer and its still-bound FBO. Their currently supported rendering operations make them the first original rendering candidates after public readback and harness-brand acceptance.

The source audit found a separate harness prerequisite. checkCanvas/checkCanvasRect use iframe-realm instanceof checks before choosing readPixels. The structural facade fails this native brand test and reaches the helper's Canvas2D branch. The direct checkCanvasRects helper used by the array-buffer original avoids that branch. This requires a recorded adapter decision while retaining original assertions.

The earlier NPOT prerequisite list omits HTMLCanvasElement-source uploads in fillCubeTexture. Its copyTexImage2D call checks a rejected nonzero NPOT level. Attachment-original copyTexImage2D/copyTexSubImage2D calls also exercise invalid-source errors. Their success paths require separate copy coverage. The packed array-buffer original executes RGBA 5_5_5_1 and 4_4_4_4, with no executed 5_6_5 case. Integration received these corrections for its manifest updates.

The earliest additional state/query candidates are gl-geterror, gl-getstring, gl-initial-state and buffer-data-and-buffer-sub-data. The reference gives exact pinned paths, functions and dependency gates for get-active-test, program-infolog and broader state cases. It also defines ImageData, HTMLCanvasElement/OffscreenCanvas and HTMLImageElement slices from the original generators, including their mandatory CubeMap and readback portions, plus origin-clean and readback-specific follow-ups.

## Verification record

Read the five existing deferred HTML files, webgl-test-utils, assertion pre/postlude, the current CTS adapter/facade, support profile and accepted resource ADR. Read additional candidate HTML/helpers/resources from pinned upstream URLs without saving or modifying their source files. A local source scan found zero gl.finish calls in each deferred file and their executed pixel helpers.

Documentation validation found no missing relative links or unpinned Khronos source links. Source inspection and documentation checks changed no runtime or upstream test source. Browser execution, GPU experiments and public API implementation remain with task025 and its follow-ups.

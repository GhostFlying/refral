# JS core migration and Buffer handle adapter

Status is complete for the Buffer foundation. Task 006 records final integration verification.

## Goal and ownership

The JS worker owns the migration from `packages/core` to `packages/core-js`, its semantic implementation, the shared Buffer adapter implementation, and package-local regression tests. The integrating agent owns root aliases, facade integration, existing callers, and shared API definitions.

## Steps

1. Move the existing implementation and package identity to `@refral/core-js`.
2. Import and re-export GL constants from the shared core API.
3. Adapt the existing semantic context to generational Buffer handles while sharing state, errors, and data with rendering.
4. Validate allocation limits and recover allocation failures as GL errors.
5. Verify handle reuse, stale and foreign inputs, copied inspection, uploads, and context loss.

## Acceptance

The Buffer adapter implements `BufferCore` and exports `createJsBufferCore(core, options)`. Buffer semantics remain owned by the existing context. Public handles are context-owned values. Inspection copies bytes and preserves error flags. Deleted-slot reuse increments generation and stale handles remain invalid. Existing JS rendering callers are updated by the integrating agent and retain their regression acceptance.

## Implementation

- Moved the existing package to `packages/core-js` with package identity `@refral/core-js`; GL constants now import and re-export the common API source.
- Added `JsBufferCore` over the rendering `SemanticContext`. Buffer bindings, errors, object data, attribute references, storage generation, and content version are shared with existing JS rendering. Its `toHandle` bridge converts legacy query results without exposing internal object classes through the common Buffer contract.
- Added context-owned positive u32 handles with slot generation reuse. Old handles fail binding validation; repeated deletion stays harmless after reuse. Handle ownership and liveness checks precede target checks, matching the native Chrome probe recorded by task 009.
- Applied the host's Buffer capacity before allocation, and convert allocation or replacement-copy failure into OUT_OF_MEMORY without changing prior data or versions. Empty subrange updates validate their offset and leave content version unchanged.
- Inspection copies bytes and preserves error flags. Loss shares the context's one-shot CONTEXT_LOST_WEBGL result. Disposal releases owned Buffer byte arrays and is idempotent, including after loss.

## Verification

`pnpm exec vitest run packages/core-js/src/buffers.test.ts tests/unit/context.test.ts tests/unit/core.test.ts` passed: 3 files and 23 tests. This includes 6 new adapter tests plus 17 pre-existing semantic/resource tests. These are CPU unit results with a mock host, not real GPU, differential, CTS, or performance evidence.

The new adapter cases cover shared renderer bindings and attribute references; consumed source subviews and preserved earlier draw bytes; slot reuse and repeated old-handle deletion; foreign-handle error precedence; copied inspection and shared errors; capacity and simulated staging allocation failure; empty updates; and context loss/disposal.

An initial `pnpm typecheck` found no core-js errors. It reported the integrating agent's in-progress facade import and shared fixture literal-type errors. Final repository typecheck and real Chrome regressions belong to task 006; their results should be recorded there. No Git commit or remote operation was performed in this task.

Final task 006 acceptance passed repository typecheck, 25 JS unit tests, all 34 Chrome tests, and built deployment verification. The JS path passed the shared Buffer/native observations and retained all 18 existing rendering differential fixtures and selected original CTS assertions. See `../validation/2026-11-13-dual-core-buffers.md` for final evidence and boundaries.

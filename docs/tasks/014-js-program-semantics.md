# JS shader and program semantics

Status is implemented, with task 013 owning integration acceptance.

## Goal and ownership

Correct the existing JS shader/program lifecycle for task 013 PR1 using the pinned WebGL specification. This task owns `packages/core-js/src/context.ts`, package-local program semantic unit tests, and this record. The integrating agent owns public facade changes, shared acceptance, and delivery.

## Plan

1. Audit installed executables, latest link status, uniform locations, and current/deleted program references against the pinned rules.
2. Reject draws and uniform operations after a failed relink while preserving installed execution through source edits, compilation, attachment, and detachment alone.
3. Preserve successful-relink uniform reset and stale-location rejection, and correct related validation only within these paths.
4. Add focused CPU regressions using a mock synchronous compiler and host, then run affected unit tests and TypeScript checking.

## Acceptance

CPU regressions cover failed relink of the current program, source/compile/attachment changes before linking, successful-relink uniform reset, stale and foreign locations, and retained shader/program deletion references. Existing JS core regressions pass. Task 013 records real Chrome, differential, CTS, integration, and delivery evidence.

## Implementation and scope

Draw validation now requires the current program's latest successful link status as well as an installed executable. Uniform updates and queries explicitly require the latest link to have succeeded. Existing link generations reject earlier uniform locations. Successful relinking resets uniform storage and sampler assignments, while shader source edits, compilation, attachment, and detachment preserve the installed executable until a link attempt. Failed-link coverage includes compiler failure, link failure, and a missing shader stage, followed by repair.

Program validation has independent status, initially false and reset by linking. Within the implemented scalar Texture2D sampler profile, `validateProgram` reports whether the latest link succeeded. Broader sampler types and arrays will require additional validation as their support is introduced. Uniform vector/matrix array lengths shorter than one assigned value or not divisible by its component count report INVALID_VALUE. Type, location, and program mismatches report INVALID_OPERATION. Null locations are ignored before transpose and array-length validation, including the three matrix setters. The native Chrome probe supplied by task 013 verifies that precedence in `artifacts/program-spec/native-uniform-validation.json`.

The existing reference lifetime is exercised through deletion of an attached shader and the current program. Uniform updates and draw snapshots continue while that program remains current, and final unbinding releases its references.

The source for current-program invalidation and uniform API validation is the pinned WebGL specification at revision `39443210f7f81db4773eb104facadfb85d05dfa4`. [Pinned WebGL specification](https://raw.githubusercontent.com/KhronosGroup/WebGL/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#CURRENT_PROGRAM_INVALIDATED)

## Verification

`pnpm exec vitest run packages/core-js/src/programs.test.ts packages/core-js/src/buffers.test.ts tests/unit/context.test.ts tests/unit/core.test.ts` passed 4 files and 36 tests, including 13 new program cases and 23 existing core/resource tests. The host and synchronous compiler are mocks in these CPU regressions.

`pnpm typecheck` passed after the shared fixture's in-progress nullable-location conversion completed. The integrating agent owns the final repository checks and browser results.

The shell initially selected a managed-runtime pnpm that attempted dependency synchronization and stopped at a non-TTY prompt. Selecting the repository's Node 24.14.0 and pnpm 10.12.3 through PATH ran the commands above without dependency changes.

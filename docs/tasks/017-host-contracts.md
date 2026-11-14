# Shared compiler and execution contracts

Status is implemented, with task 013 owning integration acceptance.

## Goal and ownership

Complete task 013 PR2 by moving compiler data and host-neutral execution types into `packages/core-api`. This task owns the new compiler/execution files and their re-exports, compiler type compatibility exports and package dependency, JS core imports/type compatibility exports, and browser host imports/package dependency. The integrating agent owns shared API additions beyond these re-exports, facade changes, repository configuration, and delivery.

## Plan

1. Move existing compiler interfaces verbatim to core-api and retain compiler type exports for existing callers.
2. Move execution records, raster-state helpers, component counts, and the semantic host contract to core-api. Represent depth attachments with neutral identity data.
3. Replace duplicate draw operation declarations with one shared type and retain existing imported names through aliases or re-exports.
4. Update JS core and browser host imports without semantic changes, remove browser-host's core-js dependency, and run TypeScript and deterministic unit verification.

## Acceptance

Browser host imports no JS implementation module. Core-api depends on neither compiler nor core-js. The compiler package depends on core-api. Shared execution contracts preserve existing JS draw, texture, framebuffer, uniform, capture, and lifetime behavior. Root TypeScript and relevant CPU tests pass, with real Chrome and integration acceptance recorded by task 013.

## Implementation

The compiler interfaces moved verbatim to `packages/core-api/src/compiler.ts`. The compiler's prior type entry continues to re-export those names for existing callers. Its workspace dependency now points at core-api.

`packages/core-api/src/execution.ts` owns the common `DrawOperation`, `TextureBinding`, `SemanticHost`, context/profile configuration, texture storage/parameters, attribute and target snapshots, raster state, raster snapshot/default helpers, and uniform component-count helper. `TargetSnapshot.depth` carries only a readonly numeric identity, with its captured generation and target dimensions already represented by the surrounding snapshot.

JS core imports the shared definitions and preserves previous exports through compatibility type exports and the `CoreDrawOperation` alias. Browser host uses the shared `DrawOperation`, implements `SemanticHost`, and imports GL, helpers, and all execution/compiler types from core-api. Its package dependency is now core-api. The migration changes module boundaries and type declarations while preserving implementation function bodies and the existing JS execution data.

## Verification and integration handoff

`pnpm typecheck` passed. `pnpm test:unit` passed 7 files and 43 tests. These commands cover deterministic CPU behavior and type compatibility, including the existing Buffer and shader/program regressions.

Source inspection confirms core-api has only local GL/compiler imports and browser host has no core-js or compiler package imports. The integrating agent owns the lockfile refresh for the two updated workspace dependency declarations and the real Chrome/deployment acceptance. This task performed no GPU verification.

The integrating agent refreshed the pinned workspace lockfile. PR1 was integrated as PR #3 at dc3f003 after the required check passed. The host-contract migration preserves that specification-corrected implementation.

The migration's complete headed Chrome run passed 45 tests in 35.4 seconds. Evidence is in `artifacts/host-contracts-chrome.log`. Existing JS rendering, original CTS, Buffer/Wasm, context loss and program regressions passed through their ordinary browser entry points.

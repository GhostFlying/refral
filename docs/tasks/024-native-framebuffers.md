# Native Rust framebuffer semantics

Status is integrated and accepted through task 020's phase-4 validation.

## Goal and ownership

Implement the bounded native framebuffer/renderbuffer module delegated by the Rust integrating worker for task 020. This task owns only the new `crates/core/src/render/framebuffers.rs`, `framebuffer_tests.rs`, and this record. The Rust integrating worker owns module registration, state/dispatch/wire changes, Cargo verification, and ABI integration.

## Plan

1. Add generational framebuffer/renderbuffer state, first-binding checks, storage allocation versions, attachment queries and completeness within the declared RGBA/depth profile.
2. Reserve retirement capacity before graph mutations and preserve deleted resources through unbound framebuffer references.
3. Produce neutral targets and ordered color-write version transitions for shared execution resources.
4. Add native regressions matching the confirmed JS/pinned-spec semantics, format/query defaults, repeated deletion, resize, and resource identity.
5. Run pinned rustfmt on owned files and hand the unreferenced module to the integrating worker for Cargo and runtime verification.

## Acceptance

The module implements the agreed ContextCore helper interface and remains unreferenced until the Rust worker's phase-4 integration. Native tests preserve first binding, query error codes, no-op repeated deletion, attachment retention and final retirement, and target/version behavior. The integrating worker records compilation, native/Wasm, and GPU acceptance.

## Implementation and verification

The module defines FramebufferState, neutral target/depth snapshots, typed object lifecycle, depth storage versions, attachment relations, native-confirmed query errors, completeness, capture, and color-write transitions. Legal depth-only and RGB targets return FRAMEBUFFER_UNSUPPORTED within the declared RGBA execution profile. Retirement capacity is reserved before graph mutation, and color-write output is reserved and version-checked before mutation.

Seven native cases cover first-binding/ownership/kind/generation behavior, default and failed storage queries, completeness/profile boundaries, attachment queries, repeated deletion with multiple retaining framebuffers, resize generations, and target/write version validation. The test file is registered as a child module from `framebuffers.rs`, preserving access to its internal state without a second sibling test registration.

Pinned `rustfmt +1.94.1 --edition 2021` completed on both owned Rust files. Cargo, Wasm, and GPU verification belong to the integrating worker. At handoff, the module is intentionally unreferenced by render.rs and requires its FramebufferState field, public snapshot re-exports, Reply::Target, INVALID_FRAMEBUFFER_OPERATION error support, dispatch/query integration, and the texture deletion callback.

## Component query follow-up plan

Extend the neutral framebuffer query path with RED/GREEN/BLUE/ALPHA/DEPTH/STENCIL bit counts. Default framebuffer queries use the integrating worker's actual context alpha/depth attributes. Bound framebuffer queries use defined color/depth attachment images, including absent attachments. Preserve error flags and the existing unsupported-profile status for depth-only/RGB targets. Add focused cases for opaque/no-depth defaults and RGBA framebuffers with optional depth, then rerun pinned rustfmt.

The component-query implementation is complete. Default RGB counts are eight, and alpha/depth follow `context_alpha`/`context_depth`. Defined bound RGBA images report eight color bits per channel, RGB images omit alpha, absent color images report zero, and defined DEPTH_COMPONENT16 backing reports 24 depth bits. Stencil remains zero in the declared profile. Two focused cases bring the module's test count to nine. Pinned rustfmt completed again; Cargo and actual adapter validation remain assigned to the integrating worker.

Integration passed 44 native tests and twenty actual-Wasm tests in the complete suites. Twenty shared RTT scenes, the three-path sequential demo and the full 85-test Chrome suite passed. Built deployment passed three-path RTT/triangle pixels, the probe and packaged ABI3/resource-protocol2 checks. Task020 records logs and the accepted module hash.

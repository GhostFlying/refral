# Public Canvas2D readPixels

Implementation and local acceptance completed on 2026-11-16 from main b1713fd. Work began on 2026-11-15. PR delivery follows the current-head required check and rebase integration workflow.

## Goal and ownership

Accept the user's Canvas2D choice through the ordinary public asynchronous factory and synchronous WebGL1 readPixels call. Both actual semantic cores own validation/target/packing plans. The common facade converts WebIDL values and destination views, the host synchronously captures the clipped GPU region through opaque sRGB packing, and the facade copies only defined pixel bytes before returning.

The integrating agent owns core-api contracts, facade/host, CTS adapter/acquisition, documentation/support metadata and delivery. Separate bounded owners implement JS semantics, Rust/native/Wasm adapter semantics, and browser verification fixtures. Each owned file has one writer. GPU validation and sampling are serialized by the integrating agent.

## Specification map and profile

Use the pinned WebGL HTML/IDL at 39443210f7f81db4773eb104facadfb85d05dfa4, especially readPixels, READS_OUTSIDE_FRAMEBUFFER, implementation read format/type queries and framebuffer completeness, plus GLES 4.3.1 and WebIDL conversions. Implement RGBA/UNSIGNED_BYTE and advertise the same implementation-selected pair. Accept Uint8Array and Uint8ClampedArray fixed views, including offsets and fixed shared storage, with GL validation for null, type mismatch, insufficient span, unsupported pairs, negative sizes and incomplete targets.

The pinned WebGL rule leaves destination bytes for pixels outside the framebuffer untouched. Padding, prefix/suffix bytes, failed calls and lost-context calls also retain their destination contents. Earlier planning shorthand describing zero-fill is corrected by these explicit assertions. Preserve synchronous return-time visibility and current-FBO selection, and retain independent snapshots and queued resource lifetimes.

## Implementation steps

1. Add ReadPixelsRequest/ReadPixelsPlan and DrawingCore.prepareReadPixels. The request contains normalized x/y/width/height, format/type, nullable viewType and destination byteLength. The plan contains the target, clipped source rectangle, destinationOffset, destinationStride and requiredBytes. No GPU/DOM objects cross the core boundary.
2. Implement per-core validation and overflow-safe row/span/clip calculations. Return null on GL error/loss, without changing target or packing state. Add implementation read format/type getters with incomplete-FBO errors. Give Rust an additive readback capability and bounded binary plan reply, with stale-Wasm guidance.
3. Add facade conversion and synchronous destination copying. Read only the clipped source rectangle through the existing Canvas capture backend, preserving all unrelated destination bytes. Keep async test capture available and cover loss/disposal and post-read drawing.
4. Record an iframe-local native WebGL prototype adapter for CTS branding while retaining original scripts/assertions. Activate original program-handling, feedback-loop and read-pixels-pack-alignment files at the pinned revision. Preserve actual context attributes and report per-file assertions for native/JS/Rust.
5. Run shared public-entry semantic/pixel fixtures, actual Wasm tests, full Chrome/CTS, build/dist and a focused public readback performance sample. Update accepted ADR007, public support entries, architecture/spec map and the dated report, then deliver through current-head required CI and rebase merge.

## Acceptance

Cover immediate read after draws/clear/uploads, alpha and opaque contexts, default/FBO targets, clipping on all edges, wholly outside rectangles, zero dimensions, PACK_ALIGNMENT 1/2/4/8 and final-row span, offset/Clamped/shared/cross-realm views, WebIDL failures, invalid-call destination/state preservation, resize, deletion, multiple contexts, loss/disposal and draw after read. Keep normative assertions when native observations differ and save those observations separately.

Use pnpm check, pnpm rust:build, pnpm rust:test:wasm, focused public-readback Chrome tests, pnpm test:chrome, pnpm build and pnpm test:dist, with pnpm ci:check for policy/docs/support. Save raw results, actual core/build/browser/adapter, source hashes and delivery metadata under ignored artifacts/readpixels. Performance labels include their exact CPU/wait/copy boundaries.

## Browser execution preference

The user requested background-only browser verification during task028. The integrating agent owns the shared Playwright/default deployment launch configuration and their evidence writers. Make headless execution the default, with REFRAL_HEADLESS=0 for an explicitly requested visible reproduction. Subsequent browser, deployment and performance commands also set REFRAL_HEADLESS=1. Preserve the earlier headed evidence and label the final headless results with their actual adapter and configuration.

## Results and delivery

The shared public profile runs synchronously through actual JS and Rust cores. Headless verification passes 92 Chrome tests, 152 CPU tests, 46 native Rust core tests, seven Wasm-crate tests and thirty actual-Wasm adapter tests. Fourteen original CTS files pass 430 assertions per backend. The eight public groups execute 296 specification checks per Refral core and preserve two explicitly recorded native extreme-input observations. Comparison/feasibility suites, built deployment and eighteen repeated public latency runs pass.

Fixed Wasm shared storage works on ordinary pages even with the shared constructor hidden. Read-only review identified that input path, which has a native/JS/Rust regression. Detached views follow zero-capacity WebIDL conversion. Background execution is the browser default following the user's request.

The [stage report](../validation/2026-11-16-public-readpixels.md) links semantics, boundaries, raw timings and exact configurations. Source/build snapshots and delivery metadata live under ignored artifacts/readpixels, with PR/current-head required-check/integrated-main provenance in delivery.json. Additional readback formats, general completion methods and context restoration remain tracked compatibility work.

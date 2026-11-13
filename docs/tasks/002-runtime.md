# WebGL1 vertical slice

Status is implemented. Final integrated rerun is owned by the integrating agent.

## Goal and ownership

Runtime worker owns `packages/webgl`, `packages/browser-host`, and `packages/core` if a TypeScript implementation is used for integration. Coordinate compiler contracts and support evidence with the integrating agent.

## Steps and acceptance

Implement a real WebGPU-backed WebGL1 slice with ordered uniform/buffer snapshots, ESSL compiler adapter integration, textures, depth/blend, framebuffer rendering, masked/scissored clear, resource generations, errors, resize, automatic submission, and asynchronous testing readback. Cover the approved P2 regressions. Record actual limitations and verification commands.

## Implementation sequence

1. Define GPU-free logical objects, immutable buffer/texture versions, error state, and draw snapshots.
2. Implement an offscreen GL-coordinate browser executor with ordered resource materialization, draw/clear passes, presentation, and asynchronous capture.
3. Implement the WebGL facade and connect the compiler adapter contract.
4. Run root type checks and integrate the parent's Chrome differential regressions.

The initial executor renders GL surfaces with row zero representing the GL bottom row and flips the default surface during canvas presentation. Shader finalization supplies the matching clip-space transform.

## Implemented boundaries

- `packages/core` contains GPU-free logical objects and `SemanticContext`, with plain `DrawingSurface` and `SemanticHost` interfaces. It owns GL state, validation, program generations, uniform packing, immutable resource versions, and draw planning.
- `packages/webgl` contains browser input adaptation, asynchronous factory, wrapper dispatch, and device-loss events. The harness-only prepared factory exposes synchronous context construction after shared device/compiler preparation and has an explicit asynchronous disposal entry.
- `packages/browser-host` owns actual WebGPU work. Uniform buffers and buffer-version caches are bounded by submission. Replaced texture/depth images retire after submitted work completes. Texture sub-images encode a prior-image copy and staging upload, then release the CPU version chain.
- Default opaque surfaces preserve alpha one for blending and capture. FBO color textures retain RGBA alpha. Driver uniforms and viewport depth range implement the GL coordinate/depth convention.
- Context loss returns neutral public results, suppresses uploads/compilation and queued submission, and reports `CONTEXT_LOST_WEBGL` once. Deleted resources retain attachment and in-flight references until their last dependency is released.

## Verification

- `pnpm exec tsc --noEmit` passed after semantic-core extraction and final lifecycle fixes.
- `pnpm exec vitest run tests/unit/context.test.ts` passed all 12 Node-only core boundary regressions.
- Integrating-agent Chrome run passed all 16 supported differential cases, including texture/FBO resize, draw-time updates, constant-alpha blend, and zero-initialized RGB alpha. The original render-to-texture demo matched native pixels exactly. The full Chrome run passed 24 tests including initial CTS and basic device loss before the final direct-core lifecycle guards.
- The integrating agent performs the final integrated check and targeted Chrome rerun after the last lifecycle fix. Evidence remains under ignored `artifacts/` and its verification report.

## Declared initial limits

Draws support triangles, FLOAT attributes, and UBYTE/USHORT indices. Matrix attributes support compiler linking and reflection, with an explicit unsupported drawing diagnostic. Texture uploads cover level-zero RGBA/RGB/ALPHA/LUMINANCE/LUMINANCE_ALPHA; mip generation is unsupported and incomplete textures sample opaque black. Renderbuffers support depth storage, backed by depth24plus with the actual 24-bit query result. Out-of-target viewport drawing has an explicit unsupported diagnostic. The default surface reports retained drawing-buffer behavior, single sampling, and its actual alpha/depth configuration. Synchronous GPU readback and native WebGL brand identity remain compatibility gaps recorded by the integrating agent.

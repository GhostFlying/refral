# Canvas and HTMLImage DOM uploads

Implementation and local acceptance are complete on 2026-11-16 as PR3 of task029, depending on task031. The user approved a private native WebGL context for HTMLImage pixel extraction after reviewing the ICC alpha investigation.

## Goal, dependencies and ownership

Accept HTMLCanvasElement, OffscreenCanvas and ready HTMLImageElement through both actual cores. Preserve intrinsic source brands, WebIDL order, availability and SecurityError behavior, return-time snapshots, flip/PMA/colorspace, source-canvas ordering and resource versions. The integrating agent owns facade/host coordination, extractor, specification mapping, ADR, support and delivery. The verification worker owns tests/fixtures/dom-canvas-image-cases.ts and tests/chrome/dom-canvas-image.spec.ts. The integrating agent runs all GPU work exclusively in headless Chrome.

## Specification and implementation plan

Use the pinned WebGL DOM overloads, TEXTURE_UPLOAD_SIZE, PIXEL_STORAGE_PARAMETERS and source-origin rules. Scalar conversion precedes source inspection. Intrinsic getters validate source brands and ignore own shadows. Source validity/security precede ordinary GL validation as observed by task031's native probe. Image uploads consume the current decoded image synchronously and preserve encoded values when colorspace conversion is NONE.

Use WebGPU external canvas copy followed by the existing opaque Canvas2D readback transport for sRGB Canvas sources, coordinating a Refral source host's pending default-target work before extraction. A focused native/GPU probe showed that a direct Canvas2D snapshot loses WebGL-source alpha-zero RGB and alters premultiplied low-alpha values. External copy matched all native values at alpha0/1/127/255 for both destination PMA settings. Generic source origin checks use a discarded1×1 Canvas2D read before GL preflight. Full pixel capture follows successful preflight. Validate source mutation through shared pixel assertions. Source-canvas helper state belongs to the facade/host boundary and is removed on disposal.

Use a small private native WebGL context for HTMLImage extraction. Pass through flip/PMA/colorspace flags to its native upload and read tightly packed RGBA through a temporary framebuffer. Mark the payload dom-converted so both semantic cores apply format normalization with transforms completed once. Validate security and readiness without changing destination GL state. Check actual image dimensions for density-corrected raster images and SVG sizing. Release helper resources explicitly and record loss/failure outcomes. The selected core continues owning destination validation, formats, versions and draw planning.

Extend DOM preparation with optional sourceContextLost and capability2 so each core reports INVALID_OPERATION for a known lost source while preserving destination state. Preparation accepts source dimensions/availability before this source-loss condition. The integrating agent owns the shared contract and JS change. The Rust worker owns its matching preflight/adapter/capability/test migration.

Record the runtime dependency and alternatives in an accepted ADR. The Chrome ICC/cICP investigation is in docs/references/chrome-external-image-alpha.md.

## Acceptance

Shared native/JS/Rust fixtures cover Canvas/Offscreen, image/subimage, palette rows, flip/PMA/colorspace, immediate caller mutation, two-draw updates, resize, source context pending work, source FBO versus default buffer, same-context canvas feedback, unloaded/broken/zero sources, source brands/cross realm/shadows, cross-origin taint and state preservation. HTMLImage fixtures include exact PNG bytes, low/zero alpha, ICC-tagged P3, image attributes, srcset density and SVG dimensions. Keep native observations and explicit specification expectations separately identified where browser behavior differs.

Run deterministic checks, actual Wasm, focused DOM cases, the complete headless browser suite and built deployment. Save raw evidence under artifacts/dom-input/pr3. Deliver through current-head ci/required and rebase merge, then verify main CI.

## Acceptance results and limits

All nine public groups pass headless Chrome157 on the Apple Metal hardware adapter. There are162 byte-exact captures per backend, with670 native assertion records and700 for each actual core. ICC NONE retains the exact encoded source bytes, including alpha-zero RGB. ICC browser-default captures match native policy exactly. Canvas source alpha0/1/127/255, current default/FBO ordering, same-context upload and registered-source loss pass.

TypeScript,201 CPU tests,58 core Rust tests,8 Wasm-crate tests, formatting/clippy and38 actual-Wasm tests pass. The complete110 browser regressions and built probe/three-path RTT/triangle/readPixels/capability checks pass. The release Wasm is291593 bytes with SHA2561ac0f7ebfc7a0b54ba96d332f38a2151a76b3c0dae76203f20910d000975d311. Raw evidence is under artifacts/dom-input/pr3 and delivery is recorded in delivery.json there.

The first integration run exposed an open render pass before external-canvas readback. The host now ends the pass before encoding the transport draw, preserving earlier draw/upload order. Fixture setup also corrected a fragment/vertex argument and records native natural dimensions and multiple-invalid errors as actual observations.

Accepted Canvas color encoding is sRGB and accepted Canvas/image output is RGBA/UNSIGNED_BYTE level zero. ImageData retains its separately verified five-format scope. Wide-gamut/HDR Canvas, additional source encodings, ImageBitmap/video and other texture targets retain compatibility tasks. Cross-realm native DOM brands are accepted. Refral pending-work/loss registration currently requires the same loaded facade module, and unregistered native-WebGL-source loss needs its own acceptance.

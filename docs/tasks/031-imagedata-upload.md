# ImageData DOM texture uploads

Implementation and local acceptance are complete on 2026-11-16 from PR1 main e6dc095, which merged PR16 after required CI. This is PR2 of task029.

## Goal and ownership

Accept ImageData texImage2D/texSubImage2D through both actual cores with WebIDL conversion, source brands, intrinsic metadata, source availability, source snapshots and correct DOM pixel layout. Preserve typed/null uploads. The integrating agent owns core-api, facade, tools/capability checks, spec map, docs/support and integration. The JS worker owns packages/core-js/src/context.ts, drawing.ts and focused DOM CPU tests. The Rust worker owns crates/core/src/render/textures.rs and render.rs, crates/wasm/src/render.rs, packages/core-wasm/src/render.ts and focused native/actual-Wasm tests. The verification worker owns tests/fixtures/dom-imagedata-cases.ts and tests/chrome/dom-imagedata.spec.ts. File ownership is exclusive and shared contract changes go through integration.

## Specification and observed conversion

Use pinned WebGL texImage/texSubImage, TEXTURE_UPLOAD_SIZE and PIXEL_STORAGE_PARAMETERS plus the pinned WebIDL source union. Public DOM input is a genuine source object and all scalar conversions complete once before source metadata/snapshot access. Invalid brands/null/undefined raise TypeError at the nonnullable WebIDL boundary. Native Chrome157 headless observations in artifacts/dom-input/probes/validation.json confirm six/seven parameter DOM arities, surplus-arity failures, intrinsic getters ignoring own shadows, source conversion after scalar valueOf and detached/empty/unavailable source INVALID_VALUE preceding GL parameter errors. This ordering is retained consistently in both cores where the fixed specification permits multiple invalid-input outcomes.

ImageData uses tightly packed owned/consumed RGBA source bytes independent of UNPACK_ALIGNMENT. Preserve zero-alpha RGB and source changes made during numeric conversion. Each core applies flip/premultiply exactly once and maps the source RGBA to the requested declared texture format. Output remains the existing canonical RGBA resource operation. The explicit first acceptance profile is unorm8 sRGB ImageData and RGBA/UNSIGNED_BYTE output, with generic five-format conversion regressions preserving prior prototype behavior. Modern additional source encodings have explicit capability outcomes and evidence.

## Frozen common contract

DomTextureUploadRequest contains normalized operation, target, level, internalFormat, x/y, source width/height, format/type and sourceValid. prepareDomTextureUpload returns null after GL error/loss or a plan containing flipY, premultiplyAlpha and colorSpaceConversion. Preparation validates source availability first, then reuses the ordinary texture validators without mutating bindings, storage or versions.

PixelUpload adds optional source equal to dom or dom-converted. Missing source retains the existing typed/null path. Both DOM modes contain tightly packed source RGBA. dom applies core unpack flip/premultiply; dom-converted carries pixels already converted/flipped by an extractor. Format normalization remains core-owned. The facade prepares before expensive pixel extraction and commits through the ordinary nine-argument internal upload form. Source extraction has no user JavaScript callbacks between preflight and commit. Commit revalidates before changing state.

Rust retains ABI3/resource2/readback1 and adds rf_dom_upload_protocol_version() returning1. Preparation uses bounded existing metadata with ordered arguments subImage,target,level,internalFormat,x,y,width,height,format,type,sourceValid. Its reply is the existing owned i32 list flipY,premultiplyAlpha,colorSpaceConversion. DOM pixel descriptors carry a validated source marker and bounded bytes, then emit existing resource operations. Adapter/build/deployment/stale-module tests migrate together.

## Steps and acceptance

1. Add the shared types/capability and source metadata path. Remove the earlier pre-WebIDL duck-typed DOM extraction from the public entry.
2. Reuse/refactor each core's texture validators for prepare and commit. Cover pure preflight, DOM tight rows, flip/PMA, format conversion, invalid source, invalid params, allocation/versions and legacy typed/null calls.
3. Add shared public native/JS/Rust fixtures for image/subimage, exact palette bytes, alignments, caller mutation, draw-time versions, intrinsic/cross-realm brands, scalar side effects, failed-state preservation and loss.
4. Run pnpm check, rust:build, rust:test:wasm, focused headless DOM/texture/CTS and complete browser regressions. Record actual adapter, source/build/browser and independent native observations. Deliver through current-head required CI and rebase merge.

All GPU/browser commands set REFRAL_HEADLESS=1 and run exclusively under integration. Save raw results under artifacts/dom-input/pr2. HTMLImage/Canvas extraction feasibility continues for PR3 using the ignored primary-source probes and its own bounded task.

## Review follow-up

The Rust owner will align DOM source dimensions across prepare and commit with the JS positive safe-integer rule. Focused native cases cover zero, negative, fractional, nonfinite and unsafe dimensions, source-first errors and failed-call state preservation. Typed zero-size uploads retain their existing validation path. Only textures.rs and dom_texture_tests.rs are implementation-owned for this correction.

## Local acceptance and remaining source work

Headless Chrome157 passes all eight public groups. Each backend has 120 exact pixel captures. Actual assertion records are native838, JS871 and Rust871, including implementation-only resource/version checks. All 101 browser regressions pass, including eighteen complete original CTS files. TypeScript,200 CPU tests,57 core Rust tests,8 Wasm-crate tests, formatting/clippy and37 actual-Wasm adapter tests pass. Built probe, three-path RTT/triangle pixels, synchronous readPixels and the new module capability pass. Raw logs and results live under artifacts/dom-input/pr2.

The release Wasm is291541 bytes with SHA256 f6f965be3d0cf0e5eb3e49c5f5edd2b1fb0ff786a312258c8a84b65153f71393. Chrome uses the Apple Metal hardware adapter with isFallbackAdapter false. Public fixtures save actual core, attributes, launch arguments and both Wasm hashes. DOM fixture shader setup initially passed a fragment string in the vertex parameter; the fixture call was corrected before the accepted run.

HTMLImage extraction feasibility exposed an ICC-specific extra premultiplication in Chrome. The source-derived cause and successful cICP control are recorded in docs/references/chrome-external-image-alpha.md. The user reviewed that investigation and approved private native WebGL extraction for HTMLImage in PR3. Canvas/HTMLImage acceptance remains with PR3. Delivery provenance is recorded in artifacts/dom-input/pr2/delivery.json.

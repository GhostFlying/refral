# Dual-core CubeMap execution

Implementation and local acceptance are complete on 2026-11-17 as PR2 of task034 from main9b57f9c after PR20 rebase integration.

## Frozen contract and ownership

Integration owns core-api, facade, browser host, tools, documentation/support, all GPU execution and delivery. The JS worker owns packages/core-js/src/context.ts, resources.ts, drawing.ts and its focused CubeMap CPU tests. The Rust worker owns the semantic/render/texture/framebuffer modules and native tests, crates/wasm render serialization/capacity modules, packages/core-wasm/src/render.ts and actual-Wasm tests. Verification owns shared CubeMap fixture/browser tests after integration releases the browser test window.

TextureVersion adds optional imageTarget and level, default2D/0. Registry keys and transitions include both. Runtime versions carry the actual face and level0. TextureBinding keeps storage/parameters, adds optional dimension2d/cube and cubeFaces for six complete canonical records in CUBE_FACES order. Incomplete cube has dimension cube, storage null and no cubeFaces. Cube storage remains core-neutral owned RGBA images. The host composes/caches a six-layer cube view from these GPU-backed canonical images, comparing all six current versions and retiring replaced aggregates.

## Implementation and specification steps

1. Fix texture object target on its first successful binding. Keep independent2D/Cube bindings per unit. Separate whole-target parameter lookup from face image lookup. Preserve wrappers and getters, including cube binding and maximum cube dimensions.
2. Store image dimensions, logical format, storage/content generations independently per face. Preserve existing2D direct fields through compatible accessors or migrate all their callers coherently. Reuse source snapshots/unpack validation. Cube texImage definitions are square, zero-sized typed/null images are legal but incomplete, and subimage regions remain rectangular.
3. Check six-face completeness, NPOT/wrap/min-filter rules and1×1 mip-filter completeness. Share sampler-type/unit checks between draw and validateProgram, before incomplete fallback or zero-count return. Include both vertex and fragment scalar samplers.
4. Delete all object bindings and retire every defined image. Preserve queued draw snapshots and parameters across updates/reallocation/deletion. Validate cube objects rejected as2D FBO attachments. Legal cube-face FBO usage has an explicit profile diagnostic until its acceptance task.
5. Retain ABI3/readback1/DOM2 and require resource3. Serialize imageTarget/level in each version and explicit dimension/presence in sample bindings. Update target/readback/draw/resource capacities and reserve all operation headers before semantic mutation. Six-face retirement needs at least248 resource bytes. Stale artifacts fail before context initialization. Adapter outputs own their copied bytes before arena reuse.

## Acceptance

Both CPU/native cores and actual Wasm verify target identity, independent bindings, six-face and per-face updates, missing/mismatched/zero images,1×1 and NPOT, samplers, cross-context/stale handles, source snapshots and deletion. Native/JS/Rust pixel fixtures cover face axes and off-axis texels, DOM sources, old/new draw versions, sampler parameters and lifecycle. All existing111 browser regressions, original18 CTS files, compiler corpus and built deployment must pass headless. Save evidence under artifacts/cubemap/pr2 and deliver through current-head required CI and rebase merge.

## Original shader backend dependency

The exact pinned CTS simpleCubeMapTextureFragmentShader uses gl_FragData[0]. The current ANGLE WGSL backend rejects this built-in during pipeline IO rewriting. The probe saved at artifacts/cubemap/pr2/original-shader-result.json confirms fragment compilation failure before link. Extend the pinned backend through an AST/pipeline IO adaptation that preserves the source array and emits scalar location outputs with array-element copies. Keep the current single-color-target profile. Add a reproducible local patch, provenance, the exact original shader compiler regression and real GPU verification. Integration owns build-script changes and actual compiler builds. The compiler worker owns the patch, compiler corpus and compiler GPU fixture.

## Initial CPU evidence

The JS implementation released its files after strict type checking and all226 unit tests passed, including16 focused CubeMap cases. It retains the existing2D representation behind image(target) and the current packed-format path. The shared verification fixture has10 groups and129 draw samples. Its type check passes, and actual headless GPU execution remains pending the coherent Rust build.

The first headless runtime run passed9/10 groups with all native/JS/Rust image bytes matching. The binding fixture combined an invalid face bind target with a texture already fixed to the cube target, observing native INVALID_OPERATION and core INVALID_ENUM. The isolated invalid-target assertion now binds null so it tests one invalid condition. The implementation behavior is unchanged. The initial log is retained as cubemap-initial.log.

## Runtime results

The rebuilt resource3 module passes46 actual-Wasm adapter tests. Complete deterministic checking passes226 CPU,66 core native and9 Wasm-crate native tests. All10 headless CubeMap groups pass on native, JS and actual Rust, with129 draw samples per backend. Explicit expected bytes, native comparisons and JS/Rust comparisons have zero mismatched channels. Browser157.0.8103.79 uses the apple/metal-3 hardware adapter. The host caches six-layer aggregates from canonical per-face images and versions, and retires invalidated aggregates through the existing GPU lifetime path. Remaining compiler/full-suite/deployment acceptance follows.

## Complete acceptance

The compiler corpus passes45 cases. Two additional direct pipelines validate28 pixels from the exact pinned original cube shader and a source-derived array-read/early-return shader, with zero mismatches and GPU diagnostics. The build applies the new zero-context gl_FragData backend patch idempotently. The complete headless Chrome suite passes122 tests, including all prior111 plus10 CubeMap groups and the fragment-output regression. All18 original CTS files pass on each backend. Existing built RTT, triangle, GPU probe, DOM and synchronous readback verification passes with resource3 and matching packaged hashes. The three complete original DOM files and built CubeMap smoke follow in task037.

Commands are pnpm check, pnpm rust:build, pnpm rust:test:wasm, pnpm compiler:build, pnpm compiler:test, pnpm test:chrome, pnpm build, pnpm test:dist and pnpm ci:check, all browser commands using REFRAL_HEADLESS=1. Raw evidence is under artifacts/cubemap/pr2. Delivery records the exact PR head, required CI, merge and main CI in delivery.json.

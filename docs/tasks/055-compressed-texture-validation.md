# Compressed texture validation without an enabled format

## Plan

Task 053 starts the state-query group with the core WebGL1 compressed texture APIs. The public facade owns ordered WebIDL conversion for the two required-view overloads. The selected semantic core validates the texture image target and binding, rejects every compressed format while no extension is enabled and leaves the bound image untouched. Querying COMPRESSED_TEXTURE_FORMATS returns a fresh empty Uint32Array. The current profile advertises zero compression extensions.

Implement the facade, JS semantics, Rust rendering semantics and Wasm adapter within their existing interfaces. Record the scope in the support matrix and specification map. Add shared public-path coverage for the typed query, errors, WebIDL conversion, texture binding and retained image data. Run deterministic CPU/native checks and build and test the actual Wasm module. The integrating agent runs headless Chrome serially against the shared test and pinned original compressed texture and extension files, preserving the optional-extension branches and their counters.

## Acceptance

- Pinned WebGL1 COMPRESSED_TEXTURE_SUPPORT and COMPRESSEDTEXIMAGE2D/COMPRESSEDTEXSUBIMAGE2D plus the IDL AllowShared ArrayBufferView overloads.
- Official compressed-tex-image, PVRTC, BPTC, RGTC, S3TC, ETC, ETC1 and ASTC originals. Compare returned typed values, no-extension GL errors, unchanged image contents, and the actual selected core.
- Run `pnpm check`, `pnpm rust:build`, `pnpm rust:test:wasm` and the relevant headless Chrome checks.

## Integration handoff

Deterministic checks passed in the isolated implementation checkout on 2026-11-18. TypeScript, 227 Vitest cases, 59 tool checks, 75 native Rust tests and the support matrix passed. The actual Rust Wasm build passed all 47 adapter tests. The headless public test and original-file runs are assigned to the integrating agent. Native execution may enable available compressed texture extensions inside the originals, so compare the branch and per-file counters alongside the terminal status.

```sh
export REFRAL_HEADLESS=1
pnpm test:chrome tests/chrome/compressed-texture.spec.ts
scope='^conformance/(textures/misc/compressed-tex-image|extensions/(ext-texture-compression-(bptc|rgtc)|s3tc-and-rgtc|webgl-compressed-texture-.*))\.html$'
for backend in native js rust; do
  pnpm conformance:run --backend "$backend" --include "$scope" --screenshots --timeout-ms 5000 --output artifacts/conformance/campaign/compressed-format-validation
done
```

The first official replay exposed two more assertions in compressed-tex-image.html on each core. The upstream helper checked the child document's TypeError constructor. The test received the parent's TypeError for missing arguments because the prepared factory created the facade in the runner. Resource WebIDL validation will use the canvas realm's TypeError constructor for its own conversion and arity errors. Exceptions raised by caller coercion retain identity. Re-run the original file and its neighboring extensions with unchanged assertions.

## Verified integration

All ten original files completed on each backend with zero failures after the realm correction. Chrome 158 passed 2,942 assertions with supported compression extensions. The JS and Rust profiles each passed 115 assertions without compression extensions. Each file has a screenshot. All three public-path tests, 47 real-Wasm adapter tests, deterministic checks and the support validator passed. Evidence lives under `artifacts/conformance/campaign/compressed/`; `official/` holds the initial two realm failures and `verified/` the successful replay at 3d216e4. This implements the no-format branches. Compression codecs and their enabled-format upload behavior remain open.

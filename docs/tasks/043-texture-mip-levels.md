# WebGL1 explicit texture mip levels

Support manual texImage2D and texSubImage2D definitions/updates and sampling across mip levels for Texture2D and CubeMap in both cores. The integrating owner owns shared execution, facade, both cores, Wasm, host, verification and support reporting. Dependencies are GLES 2.0.25 sections 3.7.1–3.7.2, 3.7.7–3.7.10 and 3.8.2, WebGL1 uploads, ADR009 and the accepted typed/DOM profiles.

1. Define each level independently, enforcing the shifted advertised dimension limit, positive powers of two for nonzero definitions and square cube images. Preserve missing levels and wrong-sized or mismatched definitions as texture completeness state. Validate updates and retire all subresources on final deletion.
2. Capture full mip chains when needed, in level-major and cube-face order, and use the existing per-image versions. Extend the Wasm resource protocol. Materialize WebGPU mip views from the canonical storage records and set independent minification and mip filters. Keep the one-level path for base-only sampling.
3. Run the original texSubImage2D and texture-size-limit files, add three-path pixel checks for manual and incomplete chains, updates between draws, filter selection and invalid calls. Run pnpm check, rust:build, rust:test:wasm, test:chrome, build and test:dist headlessly. Save evidence in artifacts/mip-levels and deliver through the required PR gate.

## Acceptance

Both manual-mip scenes pass headless Chrome 158.0.8127.36 with exact native/JS/Rust pixels. Each scene defines levels in descending order, sees different images before and after a level-one update with input mutation, validates the update rectangle, samples black for a malformed chain, and selects the base image with a non-mip filter. GPU collection keeps the last assembled image versions per sampled texture, with coordinated copy and retirement.

The six original files pass through all three backends. The size-limit file passes 1,369 native assertions and 1,297 per Refral core, with different advertised texture limits. The original subimage file now passes the level-one definition and update. Raw output is under `artifacts/mip-levels/official`. Local checks pass 132 headless Chrome regressions, 226 JS unit tests, 58 tools tests, 75 native Rust tests, 47 actual-Wasm adapter tests and built deployment with ABI4/resource4.

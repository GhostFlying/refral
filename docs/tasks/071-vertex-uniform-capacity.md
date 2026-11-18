# Increase the WebGL1 vertex uniform budget to 256 rows

Task 062 measured 144 Appendix A register rows for the original CorrectFull_vert.vert shader. Choose a 256-row profile, retaining a separate 64-row fragment limit. The compiler build and both public core factories obtain their limits from the same profile file. This task owns that file, compiler and browser boundary tests, and the accompanying spec/support record.

1. Check WebGPU uniform binding capacity against std140 expansion, the ABI stage binary lengths and the host allocation/submission paths. Confirm both core queries and the ESSL built-in report the configured vertex limit.
2. Exercise positive maximum and rejected overflow cases. Render RGBA from four scalar arrays spanning the entire logical register grid and the last physical byte range. Compare actual native, JS and Rust pixels, including independent values at the end of all four arrays.
3. Rebuild compiler Wasm, run the actual corpus, pnpm check, the headless compiler regression, and conformance's uniform packing, over-limit, varying packing and OGLES build originals. Keep fixture inputs, compiler hash, browser environment and page verdicts in the immutable validation checkout.

## Capacity and validation

All 256 rows can be occupied by four independent float[256] arrays, each filling one logical column. Their WGSL uniform binding occupies 16,384 bytes after std140 array padding. This covers the worst case of 16 physical bytes per logical scalar slot. WebGPU guarantees a 65,536-byte uniform binding in the core profile and 16,384 bytes in compatibility mode. The BrowserHost binds the two stages independently. Rust uses a checked usize stage length, serializes draw snapshot lengths as u32 and transports payload bytes separately from metadata. Both JS and Rust factories pass COMPILER_LIMITS to the queried profile. [WebGPU limits](https://www.w3.org/TR/webgpu/#limits)

The actual Wasm compiler corpus passes all 62 fixtures including the 16,384-byte vertex layout. On the official generated inputs it now links all eight OGLES build pairs. All 180 uniform packing pairs and four excess-uniform pairs have their expected outcomes using the new queried limit. pnpm check passes. Wasm SHA-256 is 115eab7fe575e355d04634fba1b3fbc39f380a0ec43e93c49d8cb327e681b916.

The immutable browser run records three RGBA pixels, each backend’s queried limit and both devices’ binding capacities under artifacts/compiler/vertex-uniform-capacity.json. The official selector covers shader-uniform-packing-restrictions, shader-with-too-many-uniforms, shader-varying-packing-restrictions, biConstants and build_009_to_016. Each backend writes full assertions and screenshots in artifacts/conformance/focused.

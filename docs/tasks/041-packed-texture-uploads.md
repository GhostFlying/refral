# Typed WebGL1 packed texture uploads

Advance both semantic cores for RGBA/4_4_4_4, RGBA/5_5_5_1 and RGB/5_6_5 using the existing level-zero 2D and cube image contract. The integrating owner handles JS and Rust texture state, facade/bridge input if needed, shared browser cases and support documentation. Dependencies include the pinned WebGL1/GLES2 specifications, existing Uint16Array facade view identification, and texture subresource and resource-version contracts.

1. Validate enums, format/type pairs, pixel view kinds, lengths, row alignment and definition/update constraints. Retain logical format and type per image. Reject mismatched updates without publishing an operation or replacing storage.
2. Decode packed native-endian words into the shared RGBA8 upload layout, preserving UNPACK row order, alpha premultiplication, zero initialization, byte offsets and return-time input ownership. Use existing ordered resource operations.
3. Test each format with explicit pixels, padded rows, updates, null definitions and errors through both cores. Run `pnpm check`, `pnpm rust:build`, `pnpm rust:test:wasm`, headless browser regressions and affected original texture and bad-argument files. Store results in `artifacts/packed-texture`. Record follow-up for packed DOM sources.

## Acceptance

The facade identifies the source view and sends packed words as little-endian bytes. The Rust adapter and core retain the view kind, and both cores retain the specified type in the logical image. The shared host still receives owned RGBA8 bytes and the existing ordered resource operations. The ABI and resource operation schema remain unchanged.

Four shared RTT scenarios verify the three packed types and CubeMap on headless Chrome 158.0.8127.36 with Apple Metal 3. They check unaligned row lengths, nonzero view offsets, flip and premultiplication, null definitions, short and wrong views, wrong subimage types, mutation after uploads, and draw order. Native, JS and Rust match every expected pixel exactly in all four scenarios. Evidence is under `artifacts/rtt/texture-packed-*/result.json`.

The official selection ran ten unchanged files per backend with the standard idle watchdog. Native passed 10/10. JS and Rust each passed 6/10. Both passed the original ArrayBufferView upload file with 8,082 assertions, texture-formats-test with 92, texture-attachment-formats with 10, and texImage2D plus both BadArgs files. The old full baseline passed one of these ten on JS and three on Rust, on Chrome 157. These are targeted results and do not update the full 971-file totals.

| Remaining original | Recorded dependency |
| --- | --- |
| gl-teximage and tex-image-with-format-and-type | Packed DOM upload overload |
| tex-input-validation | Non-depth renderbuffer storage, with preceding assertion failures retained in the raw file |
| texSubImage2D | A definition and update at mip level 1 |

Raw three-backend CTS evidence is under `artifacts/packed-texture/official`. The used Rust Wasm SHA-256 is `5d4e39c8e432742d0322474fcd789c68984488dd903e4cfd70853bf3146d414d`.

Local verification passed 129 headless Chrome regressions, 226 JS unit tests, 58 tool tests, 75 Rust native tests, 47 actual-Wasm adapter tests, the build and the deployment check. Rust formatting, TypeScript and support metadata validation passed.

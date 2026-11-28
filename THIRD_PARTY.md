# Third-party provenance

## ANGLE and Emscripten

The compiler package pins upstream revisions and the Emscripten SDK version in `packages/compiler/dependencies.json`. Its third-party notice documents compiler source selection, license, and local build adaptations. Acquired sources and SDK distributions live under `artifacts/compiler`.

## WebGL Fundamentals

`fixtures.lock.json` pins the render-to-texture example and helper resources from gfxfundamentals/webgl-fundamentals. The original source is fetched under `third_party/demo`, including `webgl/license.html`. The deterministic adapter changes context/canvas acquisition and frame scheduling. It preserves shader and rendering code. Generated adapter provenance is included in its header and `artifacts/fixtures/manifest.json`.

## Khronos WebGL CTS

`fixtures.lock.json` pins KhronosGroup/WebGL, licensed under MIT. `tools/deps-fixtures.mjs` fetches selected original test HTML, original test utilities, styles, and `LICENSE.txt` under `third_party/cts`. The iframe-scoped context bootstrap and assertion-result collection are project code. Original test identity, scripts, and assertions are retained.

## JavaScript dependencies

Exact direct versions are recorded in `package.json`. `pnpm-lock.yaml` pins the dependency graph and integrity values. Installed packages retain their upstream license notices.

## Rust binding dependencies

The semantic crate remains dependency-free. The Wasm binding pins serde 1.0.228 and serde_json 1.0.145 for command and compiler metadata. Cargo.lock records registry provenance and checksums for their complete graph. Cargo registry source packages retain upstream license files. The following expressions were read from the locked Cargo metadata.

| Packages | License expression |
| --- | --- |
| serde, serde_core, serde_derive, serde_json, itoa, proc-macro2, quote, syn | MIT OR Apache-2.0 |
| memchr | Unlicense OR MIT |
| ryu | Apache-2.0 OR BSL-1.0 |
| unicode-ident | (MIT OR Apache-2.0) AND Unicode-3.0 |

## Three.js large-scene benchmarks

The scene code in `benchmarks/three-large.ts` adapts the separate-mesh path from the Three.js instancing-performance example and the interactive-cubes example. Both use Three.js r162. The example code's MIT license is retained at `examples/three-shapes/LICENSE`. The example paths, revision and original Suzanne geometry checksum are recorded in `fixtures.lock.json`. The optional benchmark fetches that model into `artifacts/three-scene-assets/`.

## External WebGL1 benchmarks

The acquisition script pins Git revisions and retains the upstream files under ignored `artifacts/external-benchmarks/sources/`. The Refral runner supplies the context selection, clock and measurement code. The WebGL Samples repository specifies BSD-3-Clause with per-file exceptions. The Animometer extraction identifies its WebKit provenance in its README. Mozilla's AreWeFastYet license explicitly distinguishes the bundled third-party benchmarks from its MPL-2.0 harness. Unity player binaries and assets are fetched from that pinned upstream checkout. [WebGL Samples](https://github.com/WebGLSamples/WebGLSamples.github.io) · [Animometer extraction](https://github.com/kenrussell/webgl-animometer) · [Mozilla AreWeFastYet](https://github.com/mozilla/arewefastyet)

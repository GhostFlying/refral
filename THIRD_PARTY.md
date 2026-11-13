# Third-party provenance

## ANGLE and Emscripten

The compiler package pins upstream revisions and the Emscripten SDK version in `packages/compiler/dependencies.json`. Its third-party notice documents compiler source selection, license, and local build adaptations. Acquired sources and SDK distributions live under `artifacts/compiler`.

## WebGL Fundamentals

`fixtures.lock.json` pins the render-to-texture example and helper resources from gfxfundamentals/webgl-fundamentals. The original source is fetched under `third_party/demo`, including `webgl/license.html`. The deterministic adapter changes context/canvas acquisition and frame scheduling. It preserves shader and rendering code. Generated adapter provenance is included in its header and `artifacts/fixtures/manifest.json`.

## Khronos WebGL CTS

`fixtures.lock.json` pins KhronosGroup/WebGL, licensed under MIT. `tools/deps-fixtures.mjs` fetches selected original test HTML, original test utilities, styles, and `LICENSE.txt` under `third_party/cts`. The iframe-scoped context bootstrap and assertion-result collection are project code. Original test identity, scripts, and assertions are retained.

## JavaScript dependencies

Exact direct versions are recorded in `package.json`. `pnpm-lock.yaml` pins the dependency graph and integrity values. Installed packages retain their upstream license notices.

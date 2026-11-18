# HTMLVideoElement texture uploads

Implement the WebGL1 video overloads for `texImage2D` and `texSubImage2D` in the shared facade. Use the existing DOM upload contract so the JS and Rust/Wasm cores independently validate the destination, convert supported formats, and version their texture content.

## Plan

1. Follow the pinned source sizing, pixel store, and origin rules in the [specification map](../spec-map.md). Use the intrinsic video getters for branding and the dimension guess. Let the native upload determine whether the decoder has an accessible frame.
2. Reuse the facade-owned private WebGL extractor from [ADR008](../adr/008-dom-image-extraction.md). The headless path probe in `artifacts/video-upload/compare.json` records differences between external WebGPU copy and native WebGL across pinned video sources. Use native upload for orientation, color conversion, alpha and security. Resolve the actual uploaded image extent before core preflight and copy owned RGBA bytes after successful preflight.
3. Exercise frame changes, source dimensions, rejected-source behavior and ordered uploads on native, JS and actual Rust/Wasm. Run the unmodified eight video originals and the five related miscellaneous originals, recording codec and optional color-space branches.
4. Update support metadata and the roadmap. Deliver through the repository's required PR check.

The write scope is `packages/webgl/src`, shared browser tests, pinned fixture paths, and the associated specification, support, and task documentation. The core ABI and GPU executor already consume the DOM capture format. This task covers the existing supported unsigned-byte and packed destinations. WebCodecs `VideoFrame` and wider upload color-space APIs have separate scope.

## Acceptance

```sh
pnpm check
REFRAL_HEADLESS=1 pnpm test:chrome
pnpm conformance:run --backend all --include '^conformance/textures/(video/[^/]+|misc/(tex-video-using-tex-unit-non-zero|texture-npot-video|texture-corner-case-videos|video-rotation|texture-video-transparent))\.html$' --output artifacts/video-upload/official
pnpm build
REFRAL_HEADLESS=1 pnpm test:dist
```

## Results

Headless Chrome 158.0.8127.36 used the Apple M4 Max native renderer and the non-fallback Apple Metal WebGPU adapter. The pinned originals completed on all three paths with no failed assertions.

| Backend | Original files passed | Assertions passed |
| --- | ---: | ---: |
| Native WebGL | 13/13 | 749 |
| Refral JS | 13/13 | 557 |
| Refral Rust/Wasm | 13/13 | 557 |

Each of the eight format originals ran 50 assertions on native and 26 per Refral core. The original scripts detect the native `unpackColorSpace` property and include its display-P3 branch. Both Refral cores execute the default color-space path. The five miscellaneous files ran equal assertion counts across all backends. The transparent original observed an MP4 source error, decoded its WebM fallback, and passed all 242 assertions on each path.

The first implementation filtered frames by media readiness. The unchanged rotation and non-square pixel originals showed successful native uploads when playback left the element at HAVE_METADATA. The shared facade now lets native extraction decide frame availability. The non-square pixel probe established that the displayed width can exceed the actual upload width. The extractor takes its extent from the uploaded framebuffer before checking destination bounds.

The public Chrome fixture verifies both upload overloads with two paused frames of the pinned WebM, a same-origin child realm, shadowed dimensions, empty video, tainted video, and CORS-approved video. An earlier draw retains its original frame after the same texture is updated. JS and Rust match exactly at the sampled pixels. The native path differs by two in one decoded blue channel. The fixture uses a five-byte RGB tolerance and exact alpha. The full headless browser run passed 139 tests. The deterministic checks, deployment build and existing built-deployment smoke suite also passed.

Raw results live under `artifacts/video-upload/official/` and `artifacts/video-upload/public/`. The probe records are `compare.json` and `offscreen-compare.json`. The official results retain exact build hashes, selected cores, browser and adapter details, and the full run configuration. This run covers the 13 targeted originals.

Each accepted upload reads RGBA bytes synchronously before the selected core queues the texture operation. VideoFrame, ImageBitmap and explicit upload gamut selection remain separate tasks.

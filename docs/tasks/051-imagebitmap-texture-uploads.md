# ImageBitmap texture uploads

Support ImageBitmap in the existing WebGL1 DOM overloads for texture definitions and subimages. Both semantic cores use the shared capture path and keep their existing destination validation, formats, resource versions, and execution contract.

## Plan

1. Map the pinned WebGL/HTML upload, creation-option, detachment and origin rules in the [specification map](../spec-map.md).
2. Extend the shared facade and [private image extractor](../adr/008-dom-image-extraction.md). Use intrinsic bitmap dimensions across realms. Preserve created bitmap orientation and alpha representation through native upload and synchronous RGBA capture. The extractor shares its color-conversion boundary with image and video sources so a later upload color-space property can reach every source path.
3. Run the 48 pinned originals across all six ImageBitmap source groups on native WebGL, JS and Rust. Verify construction options, lifetime, transfer, security, and draw ordering in a shared headless Chrome regression.
4. Update support and roadmap records, then deliver through the required PR check.

The write scope is the shared facade and extractor, browser fixtures and associated documentation. The existing profile supplies five unsigned-byte formats, three packed formats, 2D targets and cube faces. Explicit unpack gamut selection and drawing-buffer color-space changes are separate tasks.

## Acceptance

```sh
pnpm check
REFRAL_HEADLESS=1 pnpm test:chrome
pnpm conformance:run --backend all --include '^conformance/textures/image_bitmap_from_[^/]+/[^/]+\.html$' --output artifacts/imagebitmap-upload/official
pnpm build
REFRAL_HEADLESS=1 pnpm test:dist
```

## Results

The 48 original WebGL 1.0.4 files completed in headless Chrome 158.0.8127.36 on macOS arm64. Native WebGL, Refral JS and Refral Rust/Wasm each passed all 48 files and 14,448 assertions. The Refral runs used the non-fallback Apple Metal WebGPU adapter.

| Source used to create the ImageBitmap | Files passed per backend | Assertions passed per backend |
| --- | ---: | ---: |
| ImageData | 8 | 1,928 |
| Image | 8 | 1,928 |
| Video | 8 | 968 |
| Canvas | 8 | 3,848 |
| Blob | 8 | 3,848 |
| ImageBitmap | 8 | 1,928 |

Two shared regression cases compare exact bytes across the three paths. They cover independent bitmap and GL flip/premultiply settings, intrinsic cross-realm dimensions, crop and resize, close and transfer, draw ordering, forged sources, taint and CORS. For the ICC-tagged bitmap, changing the legacy color conversion flag produced identical bytes in both overloads on this Chrome. The capture uses the source-specific native upload policy and the currently supported default target gamut.

The full headless regression passed 141 tests. Deterministic checks, the deployment build and the existing built-deployment smoke suite also passed.

Raw per-file results, adapter info, Wasm hashes and exact source fingerprints are recorded in `artifacts/imagebitmap-upload/official/`. The two shared regressions retain pixel bytes and assertions in `artifacts/imagebitmap-upload/public/`. The coverage result is scoped to these originals. An accepted bitmap upload performs synchronous RGBA readback and then uses the selected core's ordinary texture submission.

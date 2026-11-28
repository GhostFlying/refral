# Shapes point coverage investigation

Investigate the task 130 Shapes four-viewport pixel mismatch against native Chrome WebGL1 on the Mac mini. Task 073 and the [point rasterization spec map](../spec-map.md) define the existing point path. Work is confined to this record and `artifacts/point-root-cause/` and depends on the task 130 geometry checkout, real Wasm, compiler and screenshot controls.

1. Compare hardware native and Refral single-point masks across window centers and point sizes. Inspect shader and backend rasterization rules.
2. Apply a diagnostic intervention to the isolated run and compare the full Shapes final pose against the native screenshot, with an unmodified control.
3. Record exact versions, adapter, images, counts, explanatory limits and reproduction command. Use `source artifacts/draw-snapshot-release/handoff/mini-env.sh` and `python3 artifacts/geometry-performance/lock.py node artifacts/point-root-cause/probe.mjs` on port 4527 with one headless Chrome worker.

## Result

The 1,177 mismatches in the task 130 final pose are explained by the coverage of fractional-size point sprites. On the M6, the right/top edges of native WebGL points follow a different subpixel rule from the edges of Refral's triangle strips. Applying the measured edge rule in the real Rust render path produced **0 differing pixels out of 1,920,000** and recovered the exact native PNG bytes. The diagnostic changed only the point vertex expansion at `GPUDevice.createShaderModule` in the test page. All original Shapes meshes, lines, points, shaders from the application, depth tests, viewports and 30+120-frame sequence ran normally. Native and intervened PNG SHA-256 are both `0ffc5b186321ac1fc1640a7fcd6d38ebccbe2dfd67e77a815a7b77bebf691c64`. The shaders, PNGs, masks and `summary.json` are in `artifacts/point-root-cause/`.

## Measurement

Mac mini Mac18,5, Apple M6, macOS 27.2.1 (26B131), Chrome 158.0.8127.37, DPR 1, single-sample, one headless browser under the shared GPU lock. Native reported `ANGLE Metal Renderer: Apple M6`; Refral reported `apple/metal-3`, `isFallbackAdapter=false`. The replay used the task 130 `b78cb82` geometry checkout inside `artifacts/draw-snapshot-release/2026-11-28T07-23-19.170Z/checkouts/geometry`. The compiler Wasm SHA-256 was `d62226acfc67938a6d5cec1e5ee0e9c56d99636e2151ba097eafc73a03bf2a14`, Rust Wasm `52c5af557e5603784300e62a47a463c398702e7a7cc4d6c444744149dc3ff3e1`. Both unmodified final-pose screenshots exactly reproduce the corresponding task 130 RGBA control. They differ from one another at 1,177 of 1,920,000 pixels. The original ablation retained a zero difference when only points were hidden.

Shapes uses `PointsMaterial` with size 4. The captured Three.js vertex shader multiplies that size by `scale / -mvPosition.z` for perspective attenuation. Fractional point sizes are therefore common in this scene. [Scene source](../../examples/three-shapes/scene.ts#L91)

The compiler's point entry projects the square around the clip-space center using `size * center.w / viewport`. The shared host draws the four resulting vertices as a triangle strip. Contrast the native point primitive's coverage with the independently rasterized edges of that square. GLES 2.0.25 §3.3 defines a square centered on the window-space position and tests pixel centers, subject to supported sizes/granularity. The empirical subpixel rule below characterizes this native renderer only. [Compiler expansion](../../packages/compiler/patches/wgsl-point-primitives.patch) · [Host topology](../../packages/browser-host/src/index.ts#L1020) · [GLES 2.0.25](https://registry.khronos.org/OpenGL/specs/es/2.0/es_full_spec_2.0.pdf)

Each synthetic vertex rendered one isolated white point in its own black 16×16 cell without depth, textures, blending, transforms, or fragment reads of `gl_PointCoord`. The probe compared `readPixels` masks in GL window coordinates (x right, y up). In 364 selected size/center combinations, 12 differed. In 4,096 deterministic samples with independent x/y offsets and sizes between 1 and 6, 231 differed. Every difference involved the maximum covered x or y. The first covered pixel matched along both axes in all 4,096 cells. With a center at cell origin + (0.75, 0.75) and size 1.49, native covered 2×2 pixels, Refral 1×1. At the same relative center and size 1.51 the two masks reversed.

For each axis let `near = center − size/2`, `far = center + size/2` and `Q(t) = floor(16t + 0.5)/16`, in window pixels. A model of the native right/top edge is `near + Q(far) − Q(near)`. The authored quad uses `far`. The model keeps the left/bottom edge at `near`. In a sweep of 128 widths (1 through 2.984375 by 1/64) and 256 x offsets per width (by 1/256), it predicted **32,768/32,768** native x bounds. The control quad disagreed at 960 positions. The discrete pixel boundary convention used in the model is in `artifacts/point-root-cause/compare.py`. Matching the observed masks does not identify which internal hardware or driver instructions produce them.

A second 65,536-point calibration varies the lower edge and width independently by 1/256 pixel. The same model predicted all 65,536 native x bounds. Rounding point size alone to whole pixels increased the Shapes RGBA difference to 10,048 pixels. Quantizing only the span to the nearest 1/16 pixel left 551 differences. Both controls retain the original application inputs.

Three diagnostic variants of the endpoint model (`edgeUp`, `edgeEven`, `edgeDown`) all recovered the native final pose. That pose alone cannot distinguish their exact tie behavior. In the independent random atlas, the `edgeEven` shader reduced 231 mismatched point masks to one. The residual prevents a claim of universally bit-identical point rasterization. These are coverage measurements with a solid point color on one adapter and browser. Point-coordinate interpolation, other devices, MSAA and other poses require their own evidence. No production patch was part of this investigation.

## Reproduce

Run in the mini checkout with the transferred task 130 sources and builds. Each invocation holds the GPU lock for the listed jobs. These runs compare pixels and do not measure performance.

```sh
source artifacts/draw-snapshot-release/handoff/mini-env.sh
python3 artifacts/geometry-performance/lock.py node artifacts/point-root-cause/probe.mjs atlas:native:control atlas:rust:control dense:native:control dense:rust:control dense:rust:edgeEven sweep:native:control sweep:rust:control calibration:native:control
python3 artifacts/geometry-performance/lock.py node artifacts/point-root-cause/probe.mjs shapes:native:control shapes:rust:control shapes:rust:round shapes:rust:q16 shapes:rust:q32 shapes:rust:q8 shapes:rust:edgeUp shapes:rust:edgeEven shapes:rust:edgeDown
python3 artifacts/point-root-cause/compare.py
```

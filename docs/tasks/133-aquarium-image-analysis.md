# Aquarium image comparison

Investigate the task 131 Aquarium image differences at the same deterministic pose on the Mini. Use archived controls, paired native and Refral scene ablations, and isolated texture or shader controls to distinguish the causes. Scope covers diagnostics and evidence. Run the original headless Chrome channel with a single GPU worker under the common lock. Record raw evidence under `artifacts/aquarium-visual/`.

## Same-pose controls

The runtime was main `f33153d`, Chrome 158.0.8127.37 on Apple M6 Metal, one headless page at a time under the shared GPU lock. All 480,000-pixel RGB comparisons use the task 131 capture and threshold (largest absolute channel difference greater than 2). The original 30 + 120 frames and audit frame execute first. A diagnostic entry then calls the application's original mono render again while its animation clock is frozen. Each paired change is applied to both routes. These are image experiments, with no performance samples used.

| 500-fish scene change | Pixels above 2, native vs JS |
| --- | ---: |
| Original | 9,098 |
| Hide fish | 9,957 |
| Hide tank inner surface | 446 |
| Hide outer surface, museum exterior, bubbles or light rays, individually | 9,098 each |
| Disable normal maps | 292 |
| Use level zero for all 2D scene model textures | 41 |
| Use level zero for cube textures | 11,754 |

The baseline heat map concentrates differences on the structures visible through the upper tank wall. Hiding an occluder changes which surfaces can be seen, so counts from these controls cannot be added. Hiding the inner surface also changes the whole image. The texture substitution below retains the full scene.

## Interchange the generated mip levels

The inner tank model uses `GlobeInner_NM.png`, a 1024 × 1024 normal map. The upstream inner-surface fragment shader samples this 2D map, derives a surface normal and uses the refracted view direction to sample a separate environment cube texture. A small change in a sampled normal can move the environment lookup across a high-contrast structure. [Pinned Aquarium shader](https://github.com/WebGLSamples/WebGLSamples.github.io/blob/6d56695888ec72b1ef2674498e307f1ab4310226/aquarium/aquarium.html#L762)

The probe generated the normal map's mip chain on an independent native WebGL2 context on this Mini, attached each level to a framebuffer and copied the RGBA bytes. It uploaded levels 1–10 to the original texture with explicit WebGL1 `texImage2D` calls. This keeps level 0, the original trilinear filter, scene shaders, geometry, draw order and environment texture. Repeating the substitution on the native WebGL1 route verifies the reference levels in the actual scene.

| Paired experiment | 500 fish | 20,000 fish |
| --- | ---: | ---: |
| Original native vs Refral | 9,098 | 7,760 |
| Share only the inner tank normal map's lower-resolution levels | 521 | 425 |
| Share all other power-of-two 2D model mip chains | 9,087 | unmeasured |
| Share all power-of-two 2D model mip chains | 514 | 416 |

The single-texture experiment brings both scenes below task 131's image threshold of 960 pixels. The residual retains contributions from sampling and other rendering operations that the substitution leaves in place. Their individual causes have not been established.

Both cores returned identical counts for every substitution. For 500 fish, native WebGL1 with the substituted normal map produced the original RGB image exactly. For 20,000 fish, native differed at one pixel by one channel unit. The unmodified controls matched task 131's first round exactly except for three native 20,000-fish pixels with a maximum delta of one. The diagnostic substitutions were run once per route and population at the recorded pose.

## Texture readback and interpretation

A separate probe sampled the original loaded normal map with nearest texel and nearest mip selection, drawing it at each level's exact dimensions. It read RGB bytes from an opaque offscreen target to exclude presentation and alpha conversion. The base image matched across all three routes. All eleven levels matched between the Refral cores.

In the first generated level (512 × 512), 35,347 of 786,432 RGB channel values differed from native. Every difference was +1 on Refral and every affected 2 × 2 source average was an exact half-integer. For example, the four green values at the first output texel were 128, 128, 129 and 129. The two results were 128 on native and 129 on Refral. At the next level the maximum difference was two channel units. In every level, both implementations returned values within half a channel unit of the arithmetic average of the four corresponding texels in their own preceding level. This identifies rounding during successive reductions on this hardware. It does not establish a universal native tie-breaking rule.

The shared host averages four texels in a shader and stores the result in the destination texture format. GLES 2.0.25 §3.7.11 requires repeated filtered reduction and recommends a box filter, leaving the specific filter algorithm open. The measured difference provides no reason to copy the Mini's rounding into the production renderer. If identical cross-backend content is required for a visual regression, supplying the same precomputed mip levels controls that variable. [Shared downsampling pass](../../packages/browser-host/src/index.ts#L575) · [GLES mipmap generation, p. 84](https://registry.khronos.org/OpenGL/specs/es/2.0/es_full_spec_2.0.pdf#page=94)

## Evidence and reproduction

Under `artifacts/aquarium-visual/`, the 500-fish toggle run is `2026-11-28T08-34-14.446Z/`, the paired mip substitutions are `2026-11-28T08-35-17.841Z/` and `2026-11-28T08-35-39.099Z/`, and original RGB mip readbacks are `2026-11-28T08-37-17.575Z/`. The heat map `overlay.png` marks pixels above delta 2 in red on the archived 500-fish image. Reproduce the substitution and direct readback from the Mini checkout with the pinned task 131 sources and Wasm.

```sh
source artifacts/draw-snapshot-release/handoff/mini-env.sh
export REFRAL_CASES=aquarium,aquarium-20k REFRAL_BACKENDS=native,js,rust
export REFRAL_TEST=1 REFRAL_BENCHMARK=1 REFRAL_ROUNDS=1
export VARIANTS=full,mips-inner-normal,mips-others,mips-all
node artifacts/aquarium-visual/make.mjs
python3 artifacts/geometry-performance/lock.py node artifacts/aquarium-visual/run.mjs
REFRAL_CASES=aquarium REFRAL_WARMUP=2 REFRAL_SAMPLES=2 python3 artifacts/geometry-performance/lock.py node artifacts/aquarium-visual/texture.mjs
```

[The system WebKit comparison](134-webkit-aquarium-mips.md) checks the same normal-map reduction against the Safari 27.2 system engine on the Mini.

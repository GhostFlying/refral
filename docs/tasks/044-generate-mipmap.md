# WebGL1 ordered mipmap generation

Build on task 043's explicit levels and mip sampling for both cores. The integrating owner handles the facade, versioned resource protocol, cores, shared GPU downsampling and verification. Dependencies are GLES 2.0.25 section 3.7.11, the pinned WebGL1 generateMipmap method, versioned texture images, and the existing level-zero framebuffer writes.

1. Validate bound target, positive POT base dimensions, and complete matching cube faces. Generate levels 1 through the final 1×1 image with matching format/type, replacing prior definitions within that range.
2. Publish ordered derived-image operations referencing the previous level's current version. Run the GPU box filter into a new canonical allocation at operation time so it observes earlier FBO writes and stays independent from later source updates. Extend resource encoding and reserve bounded operation headers before execution.
3. Run texture-mips, cube-map-uploads-out-of-order and an explicit three-path same-task framebuffer-write/generate/minified-draw scene in headless Chrome. Preserve earlier manual level passes, deterministic/actual-Wasm checks and built deployment checks. The complete mipmap-fbo file also depends on CubeMap face attachments.

## Acceptance

Both cores generate new image versions per face and level. The resource5 bridge validates the immediately preceding logical image and the derived dimensions. BrowserHost encodes a box-filter render pass over the current GPU source after ending prior rendering. A later clear affects the next generation; already derived images retain their pixels.

The original texture-mips and cube-map-uploads-out-of-order files pass on native, JS and Rust in headless Chrome 158.0.8127.36, with 29 and two assertions per backend respectively. The first stage of mipmap-fbo reaches the expected sampled color. The second stage requires a CubeMap face attachment and is recorded as unsupported at this revision. Raw results are under `artifacts/generate-mipmap/official`.

In the three-path generation scene, a framebuffer draws alternating red and green texels. Level one samples the box-filtered result after replacing a manual definition. A later base clear leaves the previously generated sample intact until the next call, which produces blue. Both Refral cores agree with the native pixels. The raw result is under `artifacts/rtt/texture-generate-mip-from-fbo`.

Local verification passed 133 headless Chrome regressions, TypeScript, 226 JS unit tests, 58 tool tests, 75 native Rust tests, 47 actual-Wasm adapter tests, production build and deployment with ABI4/resource5/readback1/DOM2.

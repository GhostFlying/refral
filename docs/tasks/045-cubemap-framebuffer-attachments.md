# WebGL1 cube-face framebuffer attachments

Build on tasks 043–044 and the accepted cube image identity. The integrating owner handles both cores, framebuffer reference/target planning, original-case verification and support reporting. Dependencies are GLES 2.0.25 sections 4.4.3 and 4.4.5, WebGL1 attachment queries and feedback rules, and the existing image version transport.

1. Bind an RGBA CubeMap face at level zero to COLOR_ATTACHMENT0 and query the exact face and object. Check cube completeness across the six base images, then validate the selected image and optional depth dimensions. Mipmap and sampler completeness are independent.
2. Advance only the attached face's content version after draw or clear. Preserve reference identity across face swaps, preserve other faces and live unbound attachments, and retire detached deleted textures within the resource envelope.
3. Verify original cube-incomplete-fbo, mipmap-fbo and texture-cube-as-fbo-attachment and a three-path face switch, content and sampling sequence, with headless Chrome. Separate the color-renderbuffer and framebuffer-copy follow-up identified in tex-input-validation.

## Acceptance

Both cores retain the texture and face as the attachment identity. The selected face supplies render target and readback versions. Switching faces keeps the texture reference and leaves other face contents intact. The existing resource transport carries the exact face, so the resource protocol stays at version five.

The 28-file targeted run uses original WebGL1 cases at the pinned revision in headless Chrome 158.0.8127.36. Native passed 28 files, and each Refral core passed 27. On every backend, cube-incomplete-fbo, mipmap-fbo and texture-cube-as-fbo-attachment passed with four, five and 14 assertions respectively. Each core reports unsupported color renderbuffer storage in tex-input-validation before that file's copyTexImage2D and copyTexSubImage2D assertions. Results and browser diagnostics are under `artifacts/cube-framebuffer/official-final`.

The shared framebuffer scene attaches a face while another base face is missing, defines the missing face without building a mip chain, and verifies attachment completeness. It clears two faces independently, reads the first face back, rejects a rendering feedback loop, and samples both faces across queued updates. The existing CubeMap target scene verifies the exact face query and an invalid texture/target combination. Results are under `artifacts/rtt/fbo-cube-face-render-sample` and `artifacts/cubemap/pr2/cases/framebuffer-target-boundary`.

Local verification passed 134 headless Chrome regressions, with exact pixels on the three-path framebuffer scene, as well as TypeScript, 226 JS unit tests, 58 tool tests, 75 native Rust tests, 47 actual-Wasm tests, production build and deployment verification. The WebGPU adapter was Apple Metal 3.

Run `pnpm check`, `pnpm rust:build`, `pnpm rust:test:wasm`, `REFRAL_HEADLESS=1 pnpm test:chrome`, `pnpm build` and `REFRAL_HEADLESS=1 pnpm test:dist`. The original cases use `pnpm conformance:run --backend all --include '(cube-incomplete-fbo|mipmap-fbo|texture-cube-as-fbo-attachment|tex-input-validation)\.html$' --output artifacts/cube-framebuffer/reproduction`.

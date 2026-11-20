# GLSL extensions backed by WGSL

Probe the pinned ANGLE compiler's WebGL1 extension switches for OES_standard_derivatives, EXT_frag_depth and EXT_shader_texture_lod. Exercise representative fragment programs on WebGPU. Keep extension exposure per context and require both compiler and core capability in packaged builds.

Preserve WebGL compile errors before enabling the extension. Pass the enabled mask through both cores' compile requests. Map the derivative hint enum and state when OES_standard_derivatives is enabled. Keep WGSL derivatives, depth writes and texture-sampling behavior in the existing WebGPU shader pipeline. Use the matching Khronos originals and the standard extension, hint, compiler corpus and drawing regression entry points with headless Chrome. Enable each extension only after its applicable shader and draw branches pass.

[Derivatives](https://registry.khronos.org/webgl/extensions/OES_standard_derivatives/) · [Fragment depth](https://registry.khronos.org/webgl/extensions/EXT_frag_depth/) · [Texture LOD](https://registry.khronos.org/webgl/extensions/EXT_shader_texture_lod/) · [WGSL](https://www.w3.org/TR/WGSL/)

## Verification

Headless Chrome 158.0.8127.36 on the Apple Metal3 adapter finished all 52 pinned extension files and the original hint case on each backend. The newly enabled fragment depth, explicit LOD and standard derivative branches passed 27, 43 and 79 assertions respectively on native, JS and Rust. These three cases add 106 executed assertions per Refral core over their extension-absent branches. The hint test now executes 502 assertions on all three paths instead of 252 on the compatibility cores. Extension enumeration executes 71 assertions per Refral core for the ten advertised extensions. The original extension-enable-and-disable regression passed four assertions on each backend in the focused integration run.

The compiler corpus verifies that indexed sampler-array LOD and gradient calls are rejected before extension enablement and compile and link to the expected WGSL operations afterward. The separate compiler corpus (74), actual Rust/Wasm suite (55), complete Chrome suite (206), deterministic checks and built deployment all passed. Raw extension screenshots and results are under `artifacts/conformance/campaign/webgpu-shader-extensions/verified-final`. The existing readback tests use their existing test path. New shader features use ANGLE and the existing WebGPU pipeline.

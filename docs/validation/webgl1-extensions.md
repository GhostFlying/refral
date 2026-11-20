# WebGL1 extension coverage on WebGPU

This inventory covers the 39 extension names exercised or discovered by the pinned WebGL 1.0.4 inventory at `39443210f7f81db4773eb104facadfb85d05dfa4`. The dedicated extension directory contributes 52 original files. Some exercise multiple extensions, and several call the same shared helpers. Chrome 158.0.8127.36 advertised all 39 on the Apple Metal3 adapter. JS and Rust advertise the same implemented subset on this device. A passing original file can take its legal extension-absent branch. Use the per-file assertion counts and branch evidence alongside the reported list. [Pinned extension cases](https://github.com/KhronosGroup/WebGL/tree/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/conformance/extensions) · [Khronos extension registry](https://registry.khronos.org/webgl/extensions/)

## Advertised on both cores

| Extension | Implementation or requirement | Original case or evidence |
| --- | --- | --- |
| `EXT_blend_minmax` | WebGPU min/max blending | #70, 39 assertions |
| `EXT_depth_clamp` | WebGPU `depth-clip-control`, enabled per context | #73, 31 assertions |
| `EXT_frag_depth` | ANGLE to WGSL `frag_depth` | #78, 27 assertions |
| `EXT_polygon_offset_clamp` | Signed WebGPU depth bias clamp | #79, 23 assertions |
| `EXT_shader_texture_lod` | ANGLE to WGSL explicit level and gradient sampling | #80, 43 assertions |
| `EXT_sRGB` | WebGPU sRGB textures and color attachments | #81 and task 091 |
| `OES_element_index_uint` | WebGPU uint32 index buffers and GL index validation | #101, 89 assertions |
| `OES_fbo_render_mipmap` | WebGPU render target views at the attached mip level | #102, 25 assertions |
| `OES_standard_derivatives` | WGSL derivative operations and validated derivative hints | #86, 79 assertions, #447, 502 |
| `OES_texture_float` | RGBA32F storage and sample-only texture path | #87–91 and task 084 |
| `OES_texture_float_linear` | WebGPU `float32-filterable`, with texture completeness gated per context | #95, 129 assertions per Refral core |
| `OES_vertex_array_object` | Per-core VAO state and draw snapshots | #92–93 and task 083 |
| `WEBGL_debug_shaders` | Source of the actual translated WGSL artifact | #105, 32 assertions |
| `WEBGL_lose_context` | Per-generation software loss and restoration over the WebGPU host | Context lifecycle originals and task 069 |

The focused run completed 54/54 original files per backend, including the 52 dedicated extension files and two adjacent shader and state cases. The extension enumeration executed 274 assertions in native Chrome and 99 per Refral core. Raw results and case screenshots are under `artifacts/conformance/campaign/webgpu-render-extensions/verified-final`.

The float-linear original runs 97 assertions on native Chrome and 129 on each Refral core. The original permits the native path to skip its mip-filtered checks if floating-point mip generation fails. The reported 14 extensions include float-linear and depth-clamp, which are optional on a device missing their WebGPU features. [Machine-readable support matrix](../support.json)

## WebGPU implementation paths to validate

| Extension | Available building block and work remaining |
| --- | --- |
| `ANGLE_instanced_arrays` | WebGPU instance stepping and draw instance count. Divisor values above one need instance-data expansion or shader fetch. Validate vertex bounds and VAO divisor state. |
| `EXT_clip_control` | Carry clip origin and depth convention into WGSL position lowering, viewport/scissor conversion, fragment coordinates and winding. |
| `EXT_color_buffer_half_float` | Renderable RGBA16F, framebuffer formats, completeness, blending, and legal GL readback. |
| `EXT_disjoint_timer_query` | Optional `timestamp-query`, pass boundary timestamps and asynchronous query availability. Audit the WebGL disjoint flag and the synchronously queried current GPU timestamp before advertising. |
| `EXT_float_blend` | Optional `float32-blendable` once float attachments and their extension enablement rules exist. |
| `EXT_texture_compression_bptc` | Optional BC6H/BC7 formats. Implement compressed uploads, size and block validation, and format queries. |
| `EXT_texture_compression_rgtc` | Optional BC4/BC5 formats, including signed channels. Shares the compressed upload path. |
| `EXT_texture_filter_anisotropic` | WebGPU `maxAnisotropy`. Resolve the supported limit and fractional parameter semantics. A sampler above 1 requires WebGPU linear filtering in all three fields, and must still obey WebGL's mip access restrictions. |
| `EXT_texture_mirror_clamp_to_edge` | Shader coordinate folding with clamp-to-edge sampling. Verify implicit/explicit derivatives, projected lookups and mip selection. WebGPU has no equivalent address mode. |
| `OES_texture_half_float` | RGBA16F storage plus half bit encoding, uploads, redefinition and completeness. |
| `OES_texture_half_float_linear` | RGBA16F filtering once half-float uploads exist. Gate texture completeness on enablement. |
| `WEBGL_blend_func_extended` | Optional `dual-source-blending`, ANGLE fragment output lowering, state validation and output indices. |
| `WEBGL_color_buffer_float` | Renderable RGBA32F plus GL renderbuffer, attachment, readback and blend validation. |
| `WEBGL_compressed_texture_astc` | Optional ASTC LDR formats. Advertise the LDR profile after validating blocks, mip levels and sRGB. Standard WebGPU has no ASTC HDR format. |
| `WEBGL_compressed_texture_etc` | Optional ETC2/EAC formats. Shares the compressed upload path. |
| `WEBGL_compressed_texture_etc1` | ETC1 blocks are the compatible subset of ETC2 RGB8. Check WebGL's distinct validation and extension discovery. |
| `WEBGL_compressed_texture_s3tc` | Optional BC1/BC2/BC3. Preserve WebGL's separate RGB and RGBA DXT1 interpretations. |
| `WEBGL_compressed_texture_s3tc_srgb` | Optional sRGB BC1/BC2/BC3. The compressed upload contract also needs sRGB channel interpretation. |
| `WEBGL_depth_texture` | WebGPU depth/depth-stencil textures. Implement WebGL depth uploads and verify sampling components, attachment lifetime and format limitations. |
| `WEBGL_draw_buffers` | WebGPU multiple color targets plus FBO and pipeline layouts, fragment outputs, target masks and draw buffer routing. |
| `WEBGL_multi_draw` | Encode multiple draws in the same pass. Validate the full batch, add instancing and supply per-draw `gl_DrawID` in WGSL. |

The current Metal3 adapter advertises `depth-clip-control`, `float32-filterable`, `float32-blendable`, `dual-source-blending`, `timestamp-query`, `texture-compression-bc`, `texture-compression-etc2` and `texture-compression-astc`. This is the adapter's list. Individual WebGPU features must also be enabled on a requested device before use. The adapter probe is saved under `artifacts/conformance/campaign/webgpu-render-extensions/adapter-probe.json`. [WebGPU feature names and formats](https://www.w3.org/TR/webgpu/#optional-capabilities)

## Gaps in the current backend

| Extension | Gap and condition for closing it |
| --- | --- |
| `KHR_parallel_shader_compile` | ANGLE Wasm link/translation currently completes synchronously on the caller. WebGPU async pipeline creation can move GPU pipeline work, while ESSL compilation and GL link validation still run in the existing synchronous path. Original #85 checks a genuine pending-to-complete transition across frames. Revisit if a proper nonblocking compilation path can be validated. |
| `WEBGL_polygon_mode` | WebGPU has no wireframe polygon raster state. Independent line draws have different clipping and coverage semantics. Revisit with rasterization support or a proven WebGPU emulation of clipping, facing and edge coverage. |
| `WEBGL_compressed_texture_pvrtc` | WebGPU exposes no PVRTC format. A CPU/Wasm or GPU decoder to uncompressed textures could preserve images after validating precision and layout. Native compressed storage and hardware PVRTC sampling are unavailable through standard WebGPU. |
| `WEBGL_debug_renderer_info` | On Chrome 158 the WebGPU adapter exposes vendor `apple` and architecture `metal-3`, while `device` and `description` are empty. The renderer metadata withheld by WebGPU is unavailable through this host. A truthful report can expose only fields the browser supplies. |

WebGPU timestamp queries can be polled asynchronously. A timestamp written when a pass begins or ends is distinct from the WebGL extension's synchronous current timestamp query. Verify the legal counter-bit rules, disjoint reporting and the original case before treating the entire timer extension as supported. [Timer extension](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query/) · [WebGPU timestamps](https://www.w3.org/TR/webgpu/#timestamp-query) · [Parallel shader compilation](https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/) · [Polygon mode](https://registry.khronos.org/webgl/extensions/WEBGL_polygon_mode/) · [WebGPU primitive state](https://www.w3.org/TR/webgpu/#primitive-state) · [PVRTC](https://registry.khronos.org/webgl/extensions/WEBGL_compressed_texture_pvrtc/) · [WebGPU adapter information](https://www.w3.org/TR/webgpu/#gpu-adapter-information)

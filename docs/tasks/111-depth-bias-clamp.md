# Polygon depth offset clamping

Implement EXT_polygon_offset_clamp through WebGPU's signed depth bias clamp. Both cores own the clamp query, initial value, reset through polygonOffset and draw-time value. The facade owns extension identity and argument normalization. The browser host applies the clamp to the existing raster pipeline and includes it in the pipeline key. The current Wasm build carries the updated draw snapshot. Older Wasm builds retain their current extension set.

Verify the original extension test, including positive clamp raster output and disabled enum validation. Also compare negative clamp results with Chrome. Run deterministic checks, actual Wasm tests and headless Chrome regression before integration.

[WebGL extension](https://registry.khronos.org/webgl/extensions/EXT_polygon_offset_clamp/) · [WebGPU depth and stencil state](https://www.w3.org/TR/webgpu/#depth-stencil-state)

The pinned Chrome, JS and Rust runs each pass all 23 assertions in ext-polygon-offset-clamp.html. The separate negative-clamp draw compares native GL readback with the WebGPU asynchronous capture and matches both reference regions on both cores. No GPU validation errors occurred. The draw payload advances to revision 7 while the command ABI remains 6. The current adapter also reads revision 6 payloads from older modules. Evidence is under `artifacts/conformance/campaign/webgpu-render-extensions/focused`.

# Depth clamping on capable WebGPU devices

Enable EXT_depth_clamp on WebGPU devices with depth-clip-control. The facade exposes the extension enum and both cores track per-generation enablement, capability state and draw snapshots. The raster pipeline selects WebGPU's unclippedDepth state. Resource and command layouts retain compatibility with older Wasm artifacts.

Verify the original capability errors and geometry beyond both clip planes plus existing depth, point and lifecycle regression. Test in isolated headless Chrome and record feature availability on the adapter.

[WebGL EXT_depth_clamp](https://registry.khronos.org/webgl/extensions/EXT_depth_clamp/) · [WebGPU depth-clip-control](https://www.w3.org/TR/webgpu/#depth-clip-control)

The pinned original passes 31 assertions each in Chrome, JS and Rust. It exercises the default-disabled state, errors before retrieving the extension, and pixels for geometry beyond the near and far clipping planes on both sides of enablement. JS and Rust expose the extension on the measured Metal3 adapter. The additional capability flag shares the existing draw raster flag word and keeps the legacy polygon offset bit. The final focused run covers all 52 extension originals and both shader-enable and hint cases, with 54/54 original files passing per backend.

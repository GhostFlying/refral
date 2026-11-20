# Floating-point texture filtering

Expose OES_texture_float_linear on devices with WebGPU float32-filterable. Request the feature during device creation when available, preserve both cores' extension-off texture completeness, and pass the now-complete 2D and cube mip chains to filtering-capable texture layouts. The upload profile and framebuffer restrictions of OES_texture_float retain their existing scope. The Rust module reports support for the new semantic flag. Run the pinned original on three backends, verify actual fractional interpolation from a typed float texture before and after enabling, and repeat Chrome and packaged regressions.

[WebGL extension](https://registry.khronos.org/webgl/extensions/OES_texture_float_linear/) · [WebGPU float32-filterable](https://www.w3.org/TR/webgpu/#float32-filterable)

Headless Chrome native passed 97 assertions in the original. JS and Rust each passed 129 because their floating-point mip generation also completes the cases that native Chrome skips under the original's allowed failure branch. The dedicated browser regression confirms the two-texel linear mix from -7 and 0.5 and the incomplete-texture sample while the extension is disabled. The Apple Metal3 device supplied float32-filterable; the extension list is optional on other devices. Evidence is under `artifacts/conformance/campaign/webgpu-render-extensions/float`.

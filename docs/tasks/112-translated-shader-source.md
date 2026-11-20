# Translated shader source

Expose WEBGL_debug_shaders on both cores. Query the existing compiler artifact from the validated shader. Return the latest successfully compiled WGSL, or an empty string when no successful compilation is available. A new shaderSource call keeps the previous translation until compileShader runs. Use the existing wrapper validation and Rust compiler registry ownership. Old Rust artifacts retain their current extension set.

Verify the pinned original case, context identity and lifetime, a failed recompile and an attached deleted shader. Run deterministic checks, actual Wasm and headless Chrome.

[WebGL extension](https://registry.khronos.org/webgl/extensions/WEBGL_debug_shaders/)

The pinned Chrome, JS and Rust runs each pass all 32 assertions in webgl-debug-shaders.html. The Chrome regression also checks failed recompilation, retention while attached after deletion, rejected foreign shaders, and unchanged source before recompilation. Evidence is under `artifacts/conformance/campaign/webgpu-render-extensions/focused`.

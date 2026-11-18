# Use ANGLE's WebGL compiler resource checks

The public compiler wrapper constructs ANGLE in WebGL mode, but does not set the existing call-depth and expression-complexity validation options that ANGLE enables for WebGL. Adopt the pinned compiler's configured limits. Oversized shaders should produce an ordinary compilation diagnostic and leave the compiler usable for the next compilation. Keep the public compile/link methods and upstream ESSL sources unchanged.

The compiler wrapper and its specification mapping are the owned files. Validate the 73-entry Wasm shader corpus and the unchanged original WebGL compiler conformance cases, including ordinary vertex and fragment shaders in the same build. Keep the selected core, compiler fingerprint, diagnostics and unchanged assertion counts.

On the frozen build all four unchanged files passed on native, JS and actual Rust/Wasm in headless Chrome. The resource-limit file completed 49/0 on every backend. The other three shader precision files completed 3/0, 2/0 and 65/0 respectively. The compiler Wasm corpus passed 73/73. The build and corpus logs, per-file results, Wasm fingerprints and original-page screenshots are under `artifacts/conformance/campaign/compiler-options/`.

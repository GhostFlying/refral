# Incomplete samplers on a framebuffer attachment

The selected cores both reject the second draw in the pinned rendering-sampling-feedback-loop.html original. WebGL1's Feedback Loops Between Textures and the Framebuffer rule uses the GLES 2.0 sampling rules. An incomplete sampler supplies the opaque-black fallback and therefore cannot read the framebuffer attachment.

The JS and Rust draw validators will check the images actually available to the active sampler. The existing shared RTT case will cover complete, incomplete and complete again, a pixel read of the fallback, and the existing unreferenced unit. No host, public API or ABI change is expected.

Acceptance uses pnpm check, pnpm rust:build, pnpm rust:test:wasm, the fbo-feedback-loop three-way differential and the original conformance/rendering/rendering-sampling-feedback-loop.html. Run the browser tests headless with one worker and store the three original pages and assertions in artifacts/conformance/campaign/incomplete-feedback.

The original script completed with 11 passes on native Chrome and five each on JS and Rust. All three had zero failures. The native extension enabled draw-buffers branches. The differential read back opaque black from the incomplete draw, detected the loop again after restoring NEAREST, and preserved the existing red and green image assertions. Deterministic checks and 47 real-Wasm tests passed. Original results and screenshots are under artifacts/conformance/campaign/incomplete-feedback/official, with the shared pixel comparison in differential.

# Optional multi-draw, hint and state query assertion coverage

Task 107 audits the passing counts of the unchanged WebGL 1.0.4 originals at indices 118, 447 and 680. Read their exact source and shared helpers alongside the recorded f055822 three-backend checkpoints. Identify the WebGL1 mandatory assertions, declared limits and extension-on/off paths. Check the actual f1dac24 source build when branch evidence is needed; use serialized headless Chrome only. Keep results, pass messages and capability data in ignored local evidence. Report any missing mandatory behavior immediately. Own this task record only. Reconcile every observed difference against the corresponding upstream assertion family, retain the original file results and run the repository documentation checks.

## Results

In headless Chrome 158.0.8127.36 on Apple M4 Max, the three pages ran their original scripts to completion on native WebGL, Refral JS and Refral Rust/Wasm. The three count differences are accounted for. Both cores exercised all WebGL1 branches applicable to their declared capabilities in these files.

| Original WebGL1 case | Native passed | JS passed | Rust passed | Source of the difference |
| --- | ---: | ---: | ---: | --- |
| 118 · extensions/webgl-multi-draw.html | 7,930 | 45 | 45 | 7,885 assertions require WEBGL_multi_draw. |
| 447 · misc/hint.html | 502 | 252 | 252 | OES_standard_derivatives enables a second 250-assertion round. |
| 680 · state/gl-get-calls.html | 280 | 192 | 192 | Native exposes eight more fragment texture units and eight more vertex attribute slots. |

### Multi-draw

For all three backends, the original checks that the extension list agrees with getExtension, checks the divisor enum before extension enablement on a fresh context, runs ordinary drawArrays and drawElements, and checks final parsing. Each ordinary draw contributes seven assertions for valid and invalid vertex attributes plus fourteen compositing assertions. The latter exercise preserved and nonpreserved buffers, with and without a preceding clear. The two core draws account for 42 assertions. Capability detection, the initial enum check and parsing bring the total to 45. Chrome's first assertion takes the supported branch. Refral takes the original's permitted unavailable branch. [Pinned original](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/conformance/extensions/webgl-multi-draw.html) · [Vertex attribute helper](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/js/tests/invalid-vertex-attrib-test.js) · [Compositing helper](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/js/tests/compositing-test.js)

| Additional assertions when multi-draw is enabled | Count | What ran in Chrome |
| --- | ---: | --- |
| Argument validation and setup | 48 | Static and dynamic buffer usages, each with one 11-assertion ordinary and one 13-assertion instanced group |
| Shader semantics | 12 | Four rounds check the extension directive and gl_DrawID for an ordinary draw |
| Pixel fixture setup and per-draw error checks | 60 | 12 program checks and 48 NO_ERROR checks |
| Pixel regions | 7,680 | 24 ordinary configurations × 64 tiles plus 24 instanced configurations × 64 tiles × four quadrants |
| Implicit instancing enablement | 1 | The divisor enum becomes available after enabling multi-draw |
| Four additional draw entry points | 84 | Each extension entry repeats seven vertex-attribute and fourteen compositing assertions |
| **Total additional** | **7,885** | |

The pixel configurations include emulated draws used by the original as controls. Its extra SharedArrayBuffer round did not execute on any backend. All observed case realms reported crossOriginIsolated false and no SharedArrayBuffer constructor. The core WebGL1 profile currently supplies neither WEBGL_multi_draw nor ANGLE_instanced_arrays. Passing the extension-absent path supplies evidence for ordinary draws and extension discovery. [Pinned extension requirements](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/extensions/WEBGL_multi_draw/extension.xml)

### Hint

Every backend first runs 50 target names × five mode arguments plus one setup assertion and final parsing. There are 49 distinct target values because the SGIS and core mipmap-hint names share the same value. Both names succeed for DONT_CARE, FASTEST and NICEST. In that first round, the valid modes still produce INVALID_ENUM for the disabled derivative-hint target. Chrome then enables OES_standard_derivatives and repeats all 250 assertions. Exactly three expected results change to NO_ERROR for the derivative target. JS and Rust report that extension unavailable. The WebGL2 derivative-hint constant branch is outside the WebGL1 inventory for all three. [Pinned original](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/conformance/misc/hint.html) · [Derivative hint extension](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/extensions/OES_standard_derivatives/extension.xml)

### State queries

The count is 104 fixed assertions plus two per MAX_TEXTURE_IMAGE_UNITS and nine per MAX_VERTEX_ATTRIBS. The first 102 messages cover context creation, the public error method, typed getters, default state and implementation limits. The final two check NO_ERROR and parsing. Within each fragment texture unit, the original checks both default texture bindings. Within each vertex attribute slot, it checks array state, the default generic value/type and pointer offset. The observer found identical ordered fixed assertions and complete repeated groups on all three paths. Native reported 16 texture units and 16 vertex attributes. Refral reported 8 and 8, the GLES 2.0 required minima. The resulting difference is 16 texture binding checks plus 72 attribute checks. [Pinned original](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/conformance/state/gl-get-calls.html) · [Refral profile](../../packages/compiler/profile-limits.json) · [GLES 2.0 implementation limits](https://registry.khronos.org/OpenGL/specs/es/2.0/es_full_spec_2.0.pdf)

## Evidence and reproduction

The f1dac24 witness stores the original passing messages in order with counts for consecutive repetitions. It queries the two public limits and supported extension names without enabling additional extensions. For every multi-draw configuration the independent reconciliation checks the full ordered pixel rectangle sequence, including all four instanced quadrants. For hint it checks all 50 names, all five modes and the exact expected GL error in each executed round. The state query audit matches the repeated groups and compares every fixed message across all three backends. Each original retains its own result and screenshot.

At audit time the stock f055822 checkpoint supplied all three native and JS rows and Rust rows 118 and 447. The stock f1dac24 checkpoint supplied all three native rows. All eleven controls agreed with their matching witness counts. Regenerating the reconciliation picks up later checkpoints as the full runs advance. All nine entries in the focused f1dac24 witness have their own selected-core, completion, assertion and screenshot records, independent of progress in the two full campaigns. Compiler Wasm SHA-256 is `70c16657373e9265ed7dc6a40cfc70eac0f96b2055d9c66cbef283c756950c06`. Core Wasm SHA-256 is `e6095830f652136494b8ca6fa851f8de58a9e027a178e2b48bf6547a7e4057b1`.

Use `python3 artifacts/conformance/campaign/multidraw-query-assertions/reconcile.py` against the retained witness. The adjacent `observer.patch`, `witness/` and `reconciled.json` preserve the collection method, messages and group counts. For a fresh capture in an isolated f1dac24 checkout, apply the observer patch to the Refral harness, then select only `/(webgl-multi-draw|hint|gl-get-calls)\.html` in the ordinary three-backend headless runner with screenshots and the same 20-second watchdog. All upstream assets and assertions retain their pinned bytes.

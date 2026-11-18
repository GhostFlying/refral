# Legacy object identity and DOM texture error conformance

Start from the latest integrated main with the pinned WebGL 1.0.4 originals. Observe isTests.html and texImage2DHTMLBadArgs.html/texSubImage2DHTMLBadArgs.html in native, JS and Rust. Include isTestsBadArgs.html as a neighbor. Trace the legacy helper’s first failed operation and test name; several named cases use shared setup. Record the exact arguments, expected exception or GL error, state after failure and observed outcome before choosing implementation scope. Scope includes the facade’s WebIDL and DOM argument adaptation and each core's texture validation only where evidence requires it. Task 083 owns VAO features and 084 owns float texture support.

Use the WebGL1 IDL TexImageSource overloads, WebGL1 texture image validation and the GLES2 texture/attachment/object requirements in docs/spec-map.md. Keep original test source and assertions intact. Document native discrepancies explicitly. Validate each root cause as a separate atomic commit via shared tests and all affected original pages in exclusive one-worker headless Chrome, then run project checks and actual Wasm verification.

## First failure at f2b0c77

A separate observation run recorded calls through the original more/util.js GL error wrapper and return values from more/unit.js assertions. Both JS and Rust failed first on texImage2D(TEXTURE_2D, 0, RGBA, RGBA, UNSIGNED_BYTE, canvas). All three pages supplied a newly created nonzero-size canvas without a rendering context. GPUQueue.copyExternalImageToTexture threw OperationError on that source. In isTests this interrupted loadTexture before the first is* assertion. In texImage2DHTMLBadArgs it failed “canvas as data” after the four expected TypeErrors. In texSubImage2DHTMLBadArgs it failed “make texture” before the destination existed. The original runner compressed each page to one failed assertion. See [task 075](075-fresh-canvas-texture-source.md) for the implemented canvas bitmap fallback in cfc3fd7.

## Verified completion

On Chrome 158.0.8127.36 at b8a8e1f the original runner reported the following passed/failed counts for each of native, JS and actual Rust/Wasm. A second diagnostic run observed the inner assertions without changing the upstream pages, GL calls, returned values or exception propagation.

| Index and original file | Official count per backend | Inner observation on all three |
| --- | --- | --- |
| 915 isTests.html | 1/0 | 14 matching assertions. Seven texture, FBO, renderbuffer, program, shader and buffer queries before deletion and seven after. |
| 916 isTestsBadArgs.html | 43/0 | This companion uses the official JS test harness directly. |
| 922 texImage2DHTMLBadArgs.html | 1/0 | Six matching assertions. Four non-sources throw TypeError, the fresh canvas succeeds and a bad target raises INVALID_ENUM. |
| 926 texSubImage2DHTMLBadArgs.html | 1/0 | 22 matching assertions. Bounds and negative level produce INVALID_VALUE, the bad target INVALID_ENUM, format/type mismatches INVALID_OPERATION. The bad sources throw without a GL error and valid uploads succeed. |

Run the official runner with the selector `more/functions/(isTests|isTestsBadArgs|texImage2DHTMLBadArgs|texSubImage2DHTMLBadArgs)\.html`, once for each selected backend using `--screenshots`. The historical operation traces are in `artifacts/conformance/historical`, the b8a8e1f unmodified originals and screenshots in `artifacts/conformance/baseline`, and the per-operation traces in `artifacts/conformance/observed/{native,js,rust}/inner`. The existing fresh-canvas-texture.spec.ts verifies that the fallback consumes transparent black and preserves the caller's source context mode. This investigation requires no further runtime change.

After the integrated context-prototype and compiler changes, ae98823 reproduced all twelve original backend/file results and assertion counts in `artifacts/conformance/integrated-ae98823` with a screenshot for each. All four originals completed upstream in each backend.

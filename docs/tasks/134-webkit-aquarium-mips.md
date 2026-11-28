# System WebKit and Chrome Aquarium comparison

Compare the task 133 half-integer mipmap reductions on the Mini using the installed system WebKit and native Chrome. Keep the browser surface offscreen. Check the original PNG and a shared byte input, identify the actual engine and limits of the test, and investigate community expectations using primary sources. Retain raw results under `artifacts/webkit-aquarium/`.

## Per-level result

Apple M6 Mac mini, macOS 27.2.1 (26B131), Chrome 158.0.8127.37. The Apple run used the installed system WebKit framework in an offscreen WKWebView with no visible window. Safari 27.2 and the framework both report build `22625.2.8.11.9`. This exercises the shipping system engine. Safari.app's UI, browser-specific configuration and compositor fall outside this probe. The native WebGL1 renderers reported Apple GPU on WebKit and ANGLE Metal Renderer: Apple M6 on Chrome.

Each engine called `generateMipmap` on the 1024 × 1024 inner tank normal map. The first input used the original PNG, an HTML image, and Aquarium's vertical flip. The second used the identical task 133 base-level RGB values in an opaque RGBA byte array. For each input the runner sampled texel centers with nearest texel and nearest level selection, rendered all eleven levels at their exact sizes and read back opaque RGBA. Both engines' RGB values also matched the archived task 133 native result.

For **each input** the two engines agreed on all **4,194,303 RGB channel values** across levels 0–10. All 35,347 first-level channels identified in task 133 therefore match between WebKit and Chrome here. At the example texel both produced green 128 from the four values 128, 128, 129 and 129. Refral produced 129 on the same Mini in task 133.

## Specification and community evidence

- GLES 2.0.25 §3.7.11 calls for successive filtered reductions, recommends a box filter and leaves the particular filtering algorithm open. Apple also documents that Metal's driver filtering may vary by GPU family. A match on one Mac consequently establishes a local reference for this input. [GLES §3.7.11](https://registry.khronos.org/OpenGL/specs/es/2.0/es_full_spec_2.0.pdf#page=94) · [Apple Metal](https://developer.apple.com/documentation/metal/mtlblitcommandencoder/generatemipmaps(for:))
- The Khronos GLES2 dEQP test renders and reads the generated levels, configures color and filter precision for comparison, and distinguishes pass, quality warning and failure. It provides an example of how conformance testing allows numerical variation while still checking mip quality. [Khronos GLES2 mipmap test](https://github.com/KhronosGroup/VK-GL-CTS/blob/05ca62dcffe1353d8e058a6a9d759e3fa1007449/modules/gles2/functional/es2fTextureMipmapTests.cpp#L836-L872)
- The GPUWeb mipmap design discussion compares the filtering guarantees of native APIs and discusses applications that need control over their filter. In an OpenGL developer Q&A on selecting a mipmap algorithm, BDL recommends building and uploading the levels explicitly when the algorithm matters. These discussions illustrate developer practice. Neither documents a cross-browser requirement to round 128.5 in a particular direction. [GPUWeb design discussion](https://github.com/gpuweb/gpuweb/issues/386) · [OpenGL developer Q&A](https://stackoverflow.com/a/71449759)

## Full native WebGL frames

A separate replay ran the pinned Aquarium WebGL1 scene in both engines with antialiasing off. The local page loaded the TDL dependencies before Aquarium startup, disabled VR, and held the application animation callbacks until the scene and textures were ready. Both routes used the task 131 seeded random sequence and 151 fixed simulation steps. Each reported 28 scenes, zero final GL errors and the draw count below on each frame. The measurement reads the final 1024 × 1024 drawing buffer before browser presentation. The 800 × 600 CSS canvas, HUD and browser screenshot are distinct from this buffer.

| Fish | Draws/frame | Pixels with any RGB difference | Pixels with max channel delta > 2 | Largest delta |
| ---: | ---: | ---: | ---: | ---: |
| 500 | 610 | 210,935 | 200 (0.0191%) | 5 |
| 20,000 | 20,110 | 231,863 | 311 (0.0297%) | 5 |

The table uses a matched device pixel ratio of 2. At 500 fish, 207,437 pixels differed by exactly one channel unit in the maximum channel. At 20,000 fish, 226,944 did. An independent pair (Chrome DPR 1, WebKit DPR 2, identical drawing buffer sizes) gave 200 and 310 pixels above two. Task 131 counted the composited 800 × 600 canvas screenshot, so its absolute pixel counts use a different denominator and capture path. The full-frame differences here have no demonstrated dependence on the inner-tank normal map's mip generation, whose RGB bytes matched at every level.

The Mini's `artifacts/webkit-aquarium/` contains `Probe.swift` and `Scene.swift` (offscreen system WebKit harnesses), `index.html` (texture probe), `scene2.html` and associated scripts (scene replay), both Chrome runners, readbacks, route metadata, and `summary.json`. After preparing task 131/133 assets, serve the directory with `node artifacts/webkit-aquarium/server.mjs` on port 4536. From the repository root, with the Mini tool environment loaded, reproduce the texture probes serially under the shared lock:

```sh
d=artifacts/webkit-aquarium
swiftc "$d/Probe.swift" -o "$d/probe"
mkdir -p "$d/recheck-webkit" "$d/recheck-chrome"
python3 artifacts/geometry-performance/lock.py "$d/probe" http://127.0.0.1:4536/index.html "$d/recheck-webkit"
python3 artifacts/geometry-performance/lock.py node "$d/chrome.mjs" http://127.0.0.1:4536/index.html "$d/recheck-chrome"
```

## Follow-up status

Deferred by agreement. Keep the task 131 screenshot threshold and its Aquarium failures visible. Task 133 isolated the dominant inner-tank normal-map difference. The two native engines on this Mini generated identical mip RGB values for that texture. Revisit the shared host filter if closer device-specific matching becomes a product requirement. Performance comparisons continue with the image result reported alongside the workload.

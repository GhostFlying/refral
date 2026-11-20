# Continuous Three.js Marching Cubes demo

Adapt the pinned Three.js r162 Marching Cubes example to the existing native WebGL1, Refral JS and Refral Rust comparison. The original metaball trajectories and surface generator advance automatically with elapsed time. Use the upstream multicolor Phong material option, a 48³ lattice and 16 moving blobs for a visible, repeatable dynamic-geometry workload.

Share the explicit WebGL1 context setup with Shapes. Keep the standalone demo and its Vite entry separate. Use Three.js OrbitControls from the existing pin. Preserve attribution for the adapted scene. Both cores must use the same scene and upload range, with no new runtime dependencies.

Verify continuously changing pixels with no input in all three backends on headless Chrome. At a fixed timestamp compare all three screenshots at 800 × 600 and report any difference. Run pnpm check and verify the built page. Save run data and images to artifacts/three-animation.

## Adaptation

The demo retains the upstream multicolor mode, camera, lights, metaball trajectories and floor. It advances time from requestAnimationFrame timestamps and runs automatically after context initialization. The workload uses 16 metaballs on a 48³ lattice, with 800 × 600 rendering at DPR 1. Each frame regenerates position, normal and color data. After initial allocation Three.js uploads the active attribute ranges. The view can be orbited independently of the animation. The upstream MIT notice is retained under the Shapes example. [Pinned upstream example](https://github.com/mrdoob/three.js/blob/ef80ac74e6716a50104a57d8add6c8a950bff8d7/examples/webgl_marchingcubes.html)

## Verification

In Chrome 158.0.8127.36, all three backends rendered successive visibly different images with no input. In the dev run, each backend changed at least 196,286 of 480,000 pixels by more than 2 RGB levels between the two sampled times. At 1.25 seconds, all three drew 12,510 triangles in one draw call. JS and Rust matched byte for byte, and no pixel differed from native by more than 2 levels per channel. The four focused browser tests, pnpm check, build and deployment tests passed. The packaged pages verified automatic playback and switching across all three backends. The existing Shapes first frame remained usable on all three.

Reproduce with `REFRAL_HEADLESS=1 pnpm test:chrome three-marching-cubes.spec.ts`. The headless playback images, fixed-pose comparisons and built preview results are under `artifacts/three-animation`.

# External WebGL1 benchmarks

Base `d088d4a`. Import pinned community workloads and run the original application code on native WebGL1 and on the JS and actual Rust polyfills. The integrating owner maintains the acquisition pins, runner, bootstrap and report. Task 132 separately investigates point coverage.

1. Inspect licenses and pin the sources for Aquarium (default and 20K), Animometer (default and attributes), Dynamic Cube Map and Unity. Check Basemark's distribution terms.
2. Prepare the selected implementation before page startup. Capture actual context, frame work, pixels, CPU callback and frame intervals. Identify startup/profile gaps per route.
3. Use headless Chrome and the shared exclusive GPU lock. Rotate three rounds with 30 warmup and 120 sampled frames. Compare like work and report the native-relative baseline and evidence.
4. Run the affected checks, `pnpm ci:check`, and deliver through the required PR check.

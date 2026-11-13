# Browser shader compiler

The package wraps a pinned ANGLE translator compiled to Wasm. Initialization is asynchronous. Shader compilation and program linking are synchronous after initialization.

```ts
import { createCompiler } from "@refral/compiler";

const compiler = await createCompiler();
const vertex = compiler.compile(vertexSource, "vertex", 1);
const fragment = compiler.compile(fragmentSource, "fragment", 1);
const program = compiler.link(vertex, fragment, { position: 0 });
```

Check `success` and `log` on every result. Successful link results include final stage WGSL, entry points, attributes, uniforms, samplers, and buffer sizes. Uniforms have separate vertex and fragment offsets because ANGLE emits one default uniform block per stage.

## Build and test

Run from the repository root with Node 24 and CMake/Ninja available.

```sh
node tools/deps-compiler.mjs
node tools/compiler-build.mjs
node tools/compiler-test.mjs
pnpm exec playwright test compiler.spec.ts
```

Dependencies and outputs are cached in `artifacts/compiler`. The default browser base URL is `/artifacts/compiler/`. Deploy the generated `.mjs` and `.wasm` together, and pass a different base URL when using another asset location.

See `docs/adr/002-compiler.md` for layouts and evidence, and `THIRD_PARTY.md` for provenance and packaging adaptations.

## Initial resource profile

`profile-limits.json` is the shared source for the exported `COMPILER_LIMITS` object and generated C++ resource constants. It defines 8 vertex attribute locations, 128 vertex uniform vectors, 64 fragment uniform vectors, 8 varying vectors, and 8 vertex, fragment, and combined texture units. The initial executor uses one vertex buffer per active attribute and the attribute cap fits its 8 available buffer slots. The public facade reports these same values. Host-dependent texture dimensions are queried from the actual device.

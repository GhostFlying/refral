import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { cpus } from "node:os";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = resolve(root, "artifacts/compiler");
const angle = resolve(directory, "angle");
const sdk = resolve(directory, "emsdk");
const build = resolve(directory, "build");
if (!existsSync(resolve(sdk, ".emscripten")) || !existsSync(resolve(angle, "src/compiler.gni"))) {
  console.error("Compiler dependencies are missing. Run node tools/deps-compiler.mjs.");
  process.exit(1);
}
mkdirSync(build, { recursive: true });
const limits = JSON.parse(readFileSync(resolve(root, "packages/compiler/profile-limits.json"), "utf8"));
const limitHeader = Object.entries(limits).map(([name, value]) => {
  const macro = name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
  return `#define REFRAL_${macro} ${value}`;
}).join("\n") + "\n";
const limitHeaderPath = resolve(build, "refral_limits.h");
if (!existsSync(limitHeaderPath) || readFileSync(limitHeaderPath, "utf8") !== limitHeader) {
  writeFileSync(limitHeaderPath, limitHeader);
}
const mutexHeader = resolve(angle, "src/common/SimpleMutex.h");
const mutexSource = readFileSync(mutexHeader, "utf8");
const mutexGuard = "#if !defined(ANGLE_WITH_TSAN)";
const wasmMutexGuard = "#if !defined(ANGLE_WITH_TSAN) && !defined(EMSCRIPTEN)";
if (!mutexSource.includes(wasmMutexGuard)) {
  if (!mutexSource.includes(mutexGuard)) throw new Error("ANGLE mutex adaptation no longer matches upstream.");
  writeFileSync(mutexHeader, mutexSource.replace(mutexGuard, wasmMutexGuard));
}
const gni = readFileSync(resolve(angle, "src/compiler.gni"), "utf8");
function sourceGroup(name) {
  const match = gni.match(new RegExp(`\\b${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!match) throw new Error(`Missing ANGLE source group ${name}`);
  return [...match[1].matchAll(/"([^"]+\.(?:cpp|cc|c))"/g)].map((entry) => entry[1]);
}
const common = ["Float16ToFloat32.cpp", "MemoryBuffer.cpp", "PackedEnums.cpp",
  "PackedGLEnums_autogen.cpp", "PoolAlloc.cpp", "SimpleMutex.cpp", "aligned_memory.cpp",
  "angleutils.cpp", "debug.cpp", "entry_points_enum_autogen.cpp", "event_tracer.cpp",
  "mathutil.cpp", "matrix_utils.cpp", "string_utils.cpp", "tls.cpp",
  "uniform_type_info_autogen.cpp", "utilities.cpp", "system_utils.cpp",
  "system_utils_posix.cpp", "system_utils_linux.cpp", "backtrace_utils_noop.cpp"].map((name) => `src/common/${name}`);
const sources = [...new Set([
  ...sourceGroup("angle_translator_sources"),
  ...sourceGroup("angle_translator_essl_symbol_table_sources"),
  ...sourceGroup("angle_translator_lib_wgsl_sources"),
  ...sourceGroup("angle_preprocessor_sources"),
  ...common, "src/common/third_party/xxhash/src/xxhash.c", "src/common/base/anglebase/sha1.cc",
])].map((source) => resolve(angle, source));
const manifest = resolve(build, "sources.cmake");
writeFileSync(manifest, `set(ANGLE_SOURCES\n${sources.map((source) => `  "${source}"`).join("\n")}\n)\n`);
const env = { ...process.env, EM_CONFIG: resolve(sdk, ".emscripten"),
  PATH: `${resolve(sdk, "upstream/emscripten")}:${resolve(sdk, "node/24.19.0_64bit/bin") }:/opt/homebrew/bin:${process.env.PATH ?? "/usr/bin:/bin"}` };
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const name of ['wgsl-integer-minimum.patch', 'wgsl-vertex-texture.patch']) {
  const patch = resolve(root, 'packages/compiler/patches', name);
  const patchArguments = ['--unidiff-zero', '--directory=artifacts/compiler/angle', patch];
  const unapplied = spawnSync('git', ['apply', '--check', ...patchArguments], { cwd: root, env });
  if (unapplied.status === 0) {
    run('git', ['apply', ...patchArguments]);
  } else {
    const applied = spawnSync('git', ['apply', '--reverse', '--check', ...patchArguments], { cwd: root, env });
    if (applied.status !== 0) throw new Error(`ANGLE patch ${name} differs from the pinned source.`);
  }
}
run("cmake", ["-S", resolve(root, "packages/compiler/native"), "-B", build, "-G", "Ninja",
  `-DCMAKE_TOOLCHAIN_FILE=${resolve(sdk, "upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake")}`,
  "-DCMAKE_BUILD_TYPE=Release", `-DANGLE_ROOT=${angle}`, `-DSOURCE_MANIFEST=${manifest}`, `-DOUTPUT_ROOT=${directory}`]);
run("cmake", ["--build", build, "--parallel", String(Math.min(8, cpus().length))]);
console.log("ANGLE Wasm compiler built in artifacts/compiler.");

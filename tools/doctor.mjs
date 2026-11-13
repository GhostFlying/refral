import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { platform, arch, release } from 'node:os';
import { findTool, availableChrome, commandVersion } from './environment.mjs';

const tools = {};
for (const name of ['node', 'pnpm', 'python3', 'cmake', 'ninja', 'rustc', 'cargo', 'rustup', 'emcc']) {
  let executable = name === 'node' ? process.execPath : await findTool(name);
  let env = process.env;
  if (name === 'emcc' && !executable) {
    const local = resolve('artifacts/compiler/emsdk/upstream/emscripten/emcc');
    try {
      await access(local);
      executable = local;
      env = { ...process.env, EM_CONFIG: resolve('artifacts/compiler/emsdk/.emscripten') };
    } catch { /* Dependency acquisition will install the pinned local compiler. */ }
  }
  tools[name] = { path: executable, version: commandVersion(executable, ['--version'], env) };
}
const chrome = await availableChrome();
const channel = (await readFile('rust-toolchain.toml', 'utf8')).match(/^channel\s*=\s*"([^"]+)"/m)?.[1];
function rustupOutput(args) {
  if (!tools.rustup.path) return '';
  const result = spawnSync(tools.rustup.path, args, { encoding: 'utf8', timeout: 10_000 });
  return result.status === 0 ? result.stdout.trim() : '';
}
const rust = {
  channel,
  version: rustupOutput(['run', channel, 'rustc', '--version']),
  targets: rustupOutput(['target', 'list', '--installed', '--toolchain', channel]).split('\n').filter(Boolean),
  components: rustupOutput(['component', 'list', '--installed', '--toolchain', channel]).split('\n').filter(Boolean),
};
const rustReady = rust.version && rust.targets.includes('wasm32-unknown-unknown')
  && ['rustfmt', 'clippy'].every(name => rust.components.some(component => component.startsWith(`${name}-`)));
const report = {
  recordedAt: new Date().toISOString(),
  os: { platform: platform(), arch: arch(), release: release() },
  tools,
  chrome: { path: chrome, version: commandVersion(chrome) },
  rust,
  actions: [],
};
if (!tools.emcc.path) report.actions.push('Run pnpm deps:sync and pnpm compiler:build to prepare the pinned task-local Emscripten compiler.');
if (!chrome) report.actions.push('Install Google Chrome before running pnpm test:chrome.');
if (!rustReady) report.actions.push(`Install pinned Rust: rustup toolchain install ${channel} --profile minimal --component rustfmt,clippy --target wasm32-unknown-unknown`);
for (const name of ['node', 'pnpm', 'python3', 'cmake', 'ninja']) {
  if (!tools[name].path) report.actions.push(`Install ${name}; this report includes discovered NVM and local tool paths.`);
}
report.actions.push('pnpm test:probe records actual WebGPU adapter, draw/readback, presentation, and native WebGL details.');
await mkdir('artifacts/environment', { recursive: true });
await writeFile('artifacts/environment/doctor.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!chrome || !rustReady || !tools.pnpm.path || !tools.python3.path || !tools.cmake.path || !tools.ninja.path) process.exitCode = 1;

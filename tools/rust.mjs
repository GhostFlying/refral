import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { findTool } from './environment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const toolchain = await readFile(resolve(root, 'rust-toolchain.toml'), 'utf8');
const channel = toolchain.match(/^channel\s*=\s*"([^"]+)"/m)?.[1];
if (!channel) throw new Error('The root Rust toolchain requires a pinned channel.');
const rustup = process.env.REFRAL_RUSTUP ?? await findTool('rustup');
if (!rustup) throw new Error('Install rustup and the toolchain specified in rust-toolchain.toml.');

function cargo(args, extraEnv = {}) {
  const result = spawnSync(rustup, ['run', channel, 'cargo', ...args], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const operation = process.argv[2];
if (operation === 'check') {
  cargo(['fmt', '--all', '--', '--check']);
  cargo(['clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings']);
} else if (operation === 'test') {
  cargo(['test', '--workspace', '--locked']);
} else if (operation === 'build') {
  const flags = [process.env.RUSTFLAGS ?? '', '-C link-arg=--export-memory'].filter(Boolean).join(' ');
  cargo(['build', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'refral-wasm', '--locked'], { RUSTFLAGS: flags });
  const source = resolve(root, 'target/wasm32-unknown-unknown/release/refral_wasm.wasm');
  const output = resolve(root, 'artifacts/core-wasm/refral_core.wasm');
  await mkdir(dirname(output), { recursive: true });
  await copyFile(source, output);
  const binary = await readFile(output);
  const bytes = binary.byteLength;
  const module = await WebAssembly.compile(binary);
  const imports = WebAssembly.Module.imports(module);
  if (imports.length) throw new Error('The formal Rust module requires unexpected host imports.');
  const exports = new WebAssembly.Instance(module, {}).exports;
  const abi = exports.rf_abi_version?.();
  const resourceProtocol = exports.rf_resource_protocol_version?.();
  const readbackProtocol = exports.rf_readback_protocol_version?.();
  const domUploadProtocol = exports.rf_dom_upload_protocol_version?.();
  if (abi !== 4 || resourceProtocol !== 3 || readbackProtocol !== 1 || domUploadProtocol !== 2)
    throw new Error('The formal Rust module requires ABI4/resource3/readback1/DOM upload2.');
  await writeFile(resolve(dirname(output), 'build.json'), JSON.stringify({
    channel, target: 'wasm32-unknown-unknown', profile: 'release', bytes,
    sha256: createHash('sha256').update(binary).digest('hex'), abi, resourceProtocol, readbackProtocol, domUploadProtocol, imports,
  }, null, 2) + '\n');
  console.log(`Built formal semantic core Wasm (${bytes} bytes).`);
} else {
  throw new Error('Use node tools/rust.mjs check, test, or build.');
}

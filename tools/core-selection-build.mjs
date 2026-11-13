import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const rustup = process.env.REFRAL_RUSTUP ?? join(homedir(), '.cargo/bin/rustup');
const output = join(root, 'artifacts/core-selection/core.wasm');
await mkdir(dirname(output), { recursive: true });
const version = execFileSync(rustup, ['run', '1.94.1', 'rustc', '--version'], { encoding: 'utf8' }).trim();
execFileSync(rustup, [
  'run', '1.94.1', 'rustc',
  join(root, 'experiments/core-selection/core.rs'),
  '--edition=2021', '--crate-type=cdylib', '--target=wasm32-unknown-unknown',
  '-C', 'opt-level=3', '-C', 'panic=abort', '-C', 'link-arg=--export-memory', '-C', 'link-arg=--strip-all',
  '-o', output,
], { stdio: 'inherit' });
const bytes = (await readFile(output)).byteLength;
await writeFile(join(dirname(output), 'build.json'), JSON.stringify({
  rustc: version,
  target: 'wasm32-unknown-unknown',
  optimization: 3,
  dependencies: [],
  bytes,
}, null, 2) + '\n');
console.log(`Built ${output} (${bytes} bytes) with ${version}`);

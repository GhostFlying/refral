import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { arch, platform, release, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runSelection } from '../experiments/core-selection/benchmark.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = join(root, 'artifacts/core-selection');
await mkdir(directory, { recursive: true });
const bytes = await readFile(join(directory, 'core.wasm'));
const result = await runSelection(bytes);
let revision = null;
try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {
  // An empty checkout has no revision yet.
}
const output = {
  generatedAt: new Date().toISOString(),
  revision,
  environment: {
    runtime: process.version,
    v8: process.versions.v8,
    os: `${platform()} ${release()} ${arch()}`,
    cpu: cpus()[0]?.model ?? null,
  },
  build: JSON.parse(await readFile(join(directory, 'build.json'), 'utf8')),
  ...result,
};
await writeFile(join(directory, 'node-results.json'), JSON.stringify(output, null, 2) + '\n');
console.table(result.records.map(({ scene, path, p50Ms, p95Ms, correct }) => ({ scene, path, p50Ms, p95Ms, correct })));
console.log(`Raw samples written to ${join(directory, 'node-results.json')}`);

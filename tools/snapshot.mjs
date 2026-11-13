import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
if (listed.status !== 0) throw new Error('Could not enumerate repository source files.');
const paths = [...new Set(listed.stdout.split('\0').filter(Boolean))].sort();
const tree = createHash('sha256');
const files = [];
for (const path of paths) {
  const bytes = await readFile(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  tree.update(path + '\0' + sha256 + '\n');
  files.push({ path, bytes: bytes.length, sha256 });
}
const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' });
const snapshot = { recordedAt: new Date().toISOString(), head: head.status === 0 ? head.stdout.trim() : null, treeSha256: tree.digest('hex'), files };
await mkdir('artifacts/environment', { recursive: true });
await writeFile('artifacts/environment/source.json', JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Source tree ${snapshot.treeSha256} (${files.length} files).`);

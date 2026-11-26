import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const { threeScenes } = JSON.parse(await readFile('fixtures.lock.json', 'utf8'));
const { repository, revision, model } = threeScenes;
const directory = 'artifacts/three-scene-assets';
const destination = join(directory, basename(model.path));
const digest = data => createHash('sha256').update(data).digest('hex');
const cached = await readFile(destination).catch(error => {
  if (error.code !== 'ENOENT') throw error;
});
if (!cached || digest(cached) !== model.sha256) {
  const upstream = new URL(repository).pathname;
  const response = await fetch(`https://raw.githubusercontent.com${upstream}/${revision}/${model.path}`);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${model.path}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (digest(data) !== model.sha256) throw new Error(`SHA-256 mismatch for ${model.path}`);
  await mkdir(directory, { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
console.log(`Verified ${destination} at ${revision}`);

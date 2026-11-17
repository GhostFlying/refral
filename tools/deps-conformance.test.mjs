import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const revision = '1'.repeat(40);
const helper = 'sdk/tests/js/helper.js';
const files = new Map([
  ['LICENSE.txt', Buffer.from('original fixture license\n')],
  ['sdk/tests/webgl-conformance-tests.html', Buffer.from('<!doctype html><title>original runner</title>')],
  [helper, Buffer.from('window.fixture = "unchanged";\n')],
  ['sdk/tests/resources/palette.bin', Buffer.from([0, 127, 128, 255])],
]);

async function fixture(t, alterArchive) {
  const directory = await mkdtemp(path.join(tmpdir(), 'refral-conformance-deps-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'tools'));
  await cp(fileURLToPath(new URL('./deps-conformance.mjs', import.meta.url)), path.join(directory, 'tools/deps-conformance.mjs'));
  await writeFile(path.join(directory, 'fixtures.lock.json'), JSON.stringify({
    cts: { repository: 'https://github.com/KhronosGroup/WebGL', revision, license: 'MIT' },
  }));
  const cache = path.join(directory, 'artifacts/conformance/cache', revision);
  const prefix = `WebGL-${revision}`;
  const archiveSource = path.join(cache, 'archive-source', prefix);
  const tree = [{ path: 'sdk/tests', mode: '040000', type: 'tree', sha: '2'.repeat(40) }];
  for (const [file, bytes] of files) {
    await mkdir(path.dirname(path.join(archiveSource, file)), { recursive: true });
    await writeFile(path.join(archiveSource, file), bytes);
    tree.push({ path: file, type: 'blob', mode: '100644', size: bytes.length,
      sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') });
  }
  await writeFile(path.join(cache, 'tree.json'), JSON.stringify({ sha: revision, truncated: false, tree }));
  await alterArchive?.(archiveSource);
  const archive = spawnSync('tar', ['-czf', path.join(cache, `${prefix}.tar.gz`),
    '-C', path.join(cache, 'archive-source'), prefix], { encoding: 'utf8' });
  assert.equal(archive.status, 0, archive.stderr);
  const destination = path.join(directory, 'third_party/cts');
  await mkdir(path.dirname(path.join(destination, helper)), { recursive: true });
  await writeFile(path.join(destination, helper), files.get(helper));
  await mkdir(path.join(destination, 'specs'));
  await writeFile(path.join(destination, 'specs/keep.html'), 'existing pinned specification');
  return { directory, cache, destination };
}

function acquire(directory) {
  return spawnSync(process.execPath, ['tools/deps-conformance.mjs'], {
    cwd: directory, encoding: 'utf8', timeout: 10_000,
  });
}

async function manifest(directory) {
  return JSON.parse(await readFile(path.join(directory, 'artifacts/conformance/sources.json'), 'utf8'));
}

test('cached pinned sources preserve partial fixtures and specifications across repeat acquisition and repairs', async t => {
  const { directory, cache, destination } = await fixture(t);
  const first = acquire(directory);
  assert.equal(first.status, 0, first.stderr);
  const initial = await manifest(directory);
  assert.equal(initial.fileCount, 4);
  assert.equal(initial.testFileCount, 3);
  assert.equal(initial.revision, revision);
  assert.equal(initial.installation.reused, false);
  assert.equal(initial.license.name, 'MIT');
  for (const source of initial.sources) {
    assert.deepEqual(await readFile(path.join(destination, source.path)), files.get(source.path));
    assert.equal(source.sha256, createHash('sha256').update(files.get(source.path)).digest('hex'));
  }
  const originalBackup = initial.installation.previousTestsPath;
  assert.deepEqual(await readFile(path.join(directory, originalBackup, 'js/helper.js')), files.get(helper));
  assert.equal(await readFile(path.join(destination, 'specs/keep.html'), 'utf8'), 'existing pinned specification');
  const second = acquire(directory);
  assert.equal(second.status, 0, second.stderr);
  assert.equal((await manifest(directory)).installation.reused, true);
  assert.equal((await readdir(cache)).filter(file => file.startsWith('previous-tests-')).length, 1);
  await writeFile(path.join(cache, 'source', helper), 'damaged source cache');
  await writeFile(path.join(destination, helper), 'modified installed source');
  const repaired = acquire(directory);
  assert.equal(repaired.status, 0, repaired.stderr);
  const repair = await manifest(directory);
  assert.equal(repair.installation.reused, false);
  assert.deepEqual(await readFile(path.join(cache, 'source', helper)), files.get(helper));
  assert.deepEqual(await readFile(path.join(destination, helper)), files.get(helper));
  assert.equal(await readFile(path.join(directory, repair.installation.previousTestsPath, 'js/helper.js'), 'utf8'),
    'modified installed source');
});

test('archive links are rejected before extraction or replacing existing fixtures', async t => {
  const { directory, destination } = await fixture(t, async source => {
    await rm(path.join(source, helper));
    await symlink('../../../../escape', path.join(source, helper));
  });
  const result = acquire(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /link or special entry/);
  assert.deepEqual(await readFile(path.join(destination, helper)), files.get(helper));
});

test('a wrong Git blob cannot replace an existing partial installation', async t => {
  const { directory, destination } = await fixture(t, async source => {
    await writeFile(path.join(source, helper), 'archive contents differ from the pinned tree');
  });
  const result = acquire(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Pinned Git blob mismatch/);
  assert.deepEqual(await readFile(path.join(destination, helper)), files.get(helper));
});

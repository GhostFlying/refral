import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await readFile(path.join(root, 'fixtures.lock.json'), 'utf8'));
const { repository, revision, license } = lock.cts;
if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(revision)) {
  throw new Error('Conformance acquisition requires a pinned GitHub repository and full commit revision.');
}
const repositoryPath = repository.slice('https://github.com/'.length);
const repositoryName = repositoryPath.split('/')[1];
const prefix = `${repositoryName}-${revision}`;
const artifacts = path.join(root, 'artifacts/conformance');
const cache = path.join(artifacts, 'cache', revision);
const archive = path.join(cache, `${prefix}.tar.gz`);
const treePath = path.join(cache, 'tree.json');
const extracted = path.join(cache, 'source');
const destination = path.join(root, 'third_party/cts');
const archiveUrl = `https://codeload.github.com/${repositoryPath}/tar.gz/${revision}`;
const treeUrl = `https://api.github.com/repos/${repositoryPath}/git/trees/${revision}?recursive=1`;

async function exists(file) {
  try { await lstat(file); return true; }
  catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function download(url, target) {
  const temporary = `${target}.${process.pid}.part`;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'refral-conformance-acquisition' },
      signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`${response.status} fetching ${url}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function tar(args) {
  const result = spawnSync('tar', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tar failed (${result.status}): ${result.stderr.trim()}`);
  return result.stdout;
}

function safePath(value) {
  return value && !path.posix.isAbsolute(value) && !value.includes('\\') &&
    !value.split('/').some(part => part === '..' || part === '.');
}

async function sourceFiles(directory, relative = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = relative ? `${relative}/${entry.name}` : entry.name;
    if (!safePath(file)) throw new Error(`Unsafe conformance path ${file}`);
    if (entry.isDirectory()) result.push(...await sourceFiles(path.join(directory, entry.name), file));
    else if (entry.isFile()) result.push(file);
    else throw new Error(`Conformance source is not a regular file or directory: ${file}`);
  }
  return result;
}

async function validate(directory, expected, allowExtra = false) {
  const paths = new Set(await sourceFiles(directory));
  if (!allowExtra && paths.size !== expected.length) throw new Error(`Conformance source count differs in ${directory}`);
  const records = [];
  // Keep the filesystem queue bounded while hashing all original bytes.
  for (let start = 0; start < expected.length; start += 32) {
    const batch = expected.slice(start, start + 32);
    records.push(...await Promise.all(batch.map(async entry => {
      if (!paths.has(entry.path)) throw new Error(`Missing conformance source ${entry.path}`);
      const bytes = await readFile(path.join(directory, entry.path));
      const gitBlobSha1 = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (bytes.length !== entry.size || gitBlobSha1 !== entry.sha) {
        throw new Error(`Pinned Git blob mismatch for ${entry.path}`);
      }
      return { path: entry.path, bytes: bytes.length, gitBlobSha1,
        sha256: createHash('sha256').update(bytes).digest('hex') };
    })));
  }
  return records;
}

async function extract(expected) {
  const selected = [`${prefix}/sdk/tests`, `${prefix}/LICENSE.txt`];
  const entries = tar(['-tzf', archive, ...selected]).trim().split('\n');
  const regularPaths = new Set();
  for (const entry of entries) {
    const normalized = entry.replace(/\/$/, '');
    if (!safePath(normalized) || !(normalized === selected[1] || normalized === selected[0] ||
        normalized.startsWith(`${selected[0]}/`))) {
      throw new Error(`Unsafe conformance archive entry ${entry}`);
    }
    if (!entry.endsWith('/')) regularPaths.add(normalized.slice(prefix.length + 1));
  }
  if (regularPaths.size !== expected.length || expected.some(entry => !regularPaths.has(entry.path))) {
    throw new Error('Conformance archive inventory differs from the pinned Git tree.');
  }
  // Reject links and special entries before allowing tar to create anything.
  const modes = tar(['-tvzf', archive, ...selected]).trim().split('\n');
  if (modes.some(entry => !entry.startsWith('-') && !entry.startsWith('d'))) {
    throw new Error('Conformance archive subtree contains a link or special entry.');
  }
  const temporary = await mkdtemp(path.join(cache, 'extract-'));
  try {
    tar(['-xzf', archive, '-C', temporary, '--strip-components=1', '--no-same-owner', ...selected]);
    const sources = await validate(temporary, expected);
    await rm(extracted, { recursive: true, force: true });
    await rename(temporary, extracted);
    return sources;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function install(expected) {
  const testsParent = path.join(destination, 'sdk');
  const tests = path.join(testsParent, 'tests');
  await mkdir(testsParent, { recursive: true });
  const temporary = await mkdtemp(path.join(testsParent, '.conformance-'));
  let backup = null;
  try {
    await cp(path.join(extracted, 'sdk/tests'), path.join(temporary, 'tests'), { recursive: true });
    const stagedSources = expected.filter(entry => entry.path.startsWith('sdk/tests/'))
      .map(entry => ({ ...entry, path: entry.path.slice('sdk/tests/'.length) }));
    await validate(path.join(temporary, 'tests'), stagedSources);
    if (await exists(tests)) {
      backup = path.join(cache, `previous-tests-${Date.now()}`);
      await rename(tests, backup);
    }
    try { await rename(path.join(temporary, 'tests'), tests); }
    catch (error) {
      if (backup) await rename(backup, tests);
      throw error;
    }
    await cp(path.join(extracted, 'LICENSE.txt'), path.join(destination, 'LICENSE.txt'));
    return backup ? path.relative(root, backup) : null;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

await mkdir(cache, { recursive: true });
if (!await exists(treePath)) await download(treeUrl, treePath);
const tree = JSON.parse(await readFile(treePath, 'utf8'));
if (tree.sha !== revision || tree.truncated || !Array.isArray(tree.tree)) {
  throw new Error('Conformance source tree must be complete and match the pinned revision.');
}
const expected = tree.tree.filter(entry => entry.type === 'blob' &&
  (entry.path.startsWith('sdk/tests/') || entry.path === 'LICENSE.txt')).sort((a, b) => a.path.localeCompare(b.path));
if (!expected.some(entry => entry.path === 'sdk/tests/webgl-conformance-tests.html') ||
    expected.some(entry => !safePath(entry.path) || !['100644', '100755'].includes(entry.mode))) {
  throw new Error('Pinned conformance tree has an unsupported source entry or is missing its official runner.');
}
if (!await exists(archive)) await download(archiveUrl, archive);
let sources;
try { sources = await validate(extracted, expected); }
catch { sources = await extract(expected); }
let previousTestsPath = null;
let reusedInstallation = false;
try {
  // Other dependency commands also retain pinned specification files under this root.
  await validate(destination, expected, true);
  reusedInstallation = true;
} catch { previousTestsPath = await install(expected); }
await validate(destination, expected, true);
const licenseSource = sources.find(source => source.path === 'LICENSE.txt');
const sdkSources = sources.filter(source => source.path.startsWith('sdk/tests/'));
const manifest = {
  repository, revision, sourceRoot: 'third_party/cts', testRoot: 'sdk/tests',
  license: { name: license, ...licenseSource },
  archive: { url: archiveUrl, path: path.relative(root, archive), bytes: (await lstat(archive)).size,
    sha256: await sha256(archive) },
  tree: { url: treeUrl, path: path.relative(root, treePath), sha256: await sha256(treePath),
    revision: tree.sha, sdkTestsGitTreeSha1: tree.tree.find(entry => entry.path === 'sdk/tests')?.sha,
    truncated: false },
  testFileCount: sdkSources.length, fileCount: sources.length,
  totalBytes: sources.reduce((total, source) => total + source.bytes, 0),
  validation: 'All source sizes and Git blob SHA1 values match the complete pinned Git tree. Source SHA256 values describe unchanged original files.',
  installation: { reused: reusedInstallation, previousTestsPath }, sources,
};
const manifestPath = path.join(artifacts, 'sources.json');
const temporaryManifest = `${manifestPath}.${process.pid}.part`;
try {
  await writeFile(temporaryManifest, JSON.stringify(manifest, null, 2) + '\n');
  await rename(temporaryManifest, manifestPath);
} finally { await rm(temporaryManifest, { force: true }); }
console.log(`Official CTS sources ready at third_party/cts/sdk/tests (${sdkSources.length} files, ${revision}).`);
console.log('Source, archive and license provenance saved to artifacts/conformance/sources.json.');

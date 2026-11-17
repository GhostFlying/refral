import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const lock = JSON.parse(await readFile('fixtures.lock.json', 'utf8'));
async function download(repository, revision, file, destination) {
  const githubPath = repository.replace('https://github.com/', '');
  const url = `https://raw.githubusercontent.com/${githubPath}/${revision}/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  return { path: file, url, bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex') };
}

const demoFiles = [lock.demo.source, 'webgl/resources/webgl-utils.js', 'webgl/resources/m4.js', 'webgl/resources/webgl-tutorials.css', 'webgl/license.html'];
const demoSources = await Promise.all(demoFiles.map((file) => download(lock.demo.repository,
  lock.demo.revision, file, `third_party/demo/${file}`)));
const ctsFiles = [...new Set([...lock.cts.tests, ...(lock.cts.preparedTests ?? []),
  ...(lock.cts.supportFiles ?? []), ...lock.cts.specifications,
  ...lock.cts.deferredTests.map(test => test.path),
  'LICENSE.txt', 'sdk/tests/js/js-test-pre.js', 'sdk/tests/js/js-test-post.js',
  'sdk/tests/js/webgl-test-utils.js', 'sdk/tests/js/glsl-conformance-test.js',
  'sdk/tests/js/desktop-gl-constants.js', 'sdk/tests/resources/js-test-style.css',
  'sdk/tests/resources/glsl-feature-tests.css', 'sdk/tests/resources/vertexShader.vert',
  'sdk/tests/resources/fragmentShader.frag'])];
const ctsSources = await Promise.all(ctsFiles.map((file) => download(lock.cts.repository,
  lock.cts.revision, file, `third_party/cts/${file}`)));

const original = await readFile(`third_party/demo/${lock.demo.source}`, 'utf8');
const scripts = [...original.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
let body = scripts.find((script) => script.includes('function main()'));
if (!body) throw new Error('Pinned demo main function was not found.');
const setup = /function main\(\) \{[\s\S]*?var gl = canvas\.getContext\("webgl"\);/;
if (!setup.test(body)) throw new Error('Pinned demo context bootstrap changed.');
body = body.replace(setup, 'export function createScene(gl, canvas) {');
const raf = 'requestAnimationFrame(drawScene);';
if (body.split(raf).length !== 3) throw new Error('Pinned demo frame scheduling changed.');
body = body.replace(raf, 'return drawScene;').replace(raf, '');
body = body.replace(/\nmain\(\);\s*$/, '\n');
await mkdir('artifacts/fixtures', { recursive: true });
await writeFile('artifacts/fixtures/render-to-texture.mjs', `// Adapted from ${lock.demo.repository} at ${lock.demo.revision}.\n// BSD license retained in third_party/demo/webgl/license.html.\n// Adapter injects context/canvas and exposes deterministic frame control.\n${body}`);
await writeFile('artifacts/fixtures/manifest.json', JSON.stringify({ ...lock,
  sources: { demo: demoSources, cts: ctsSources },
  adaptations: ['demo context and canvas injection', 'demo deterministic frame scheduling',
    'CTS context bootstrap supplied by test harness'],
}, null, 2) + '\n');
console.log('Fetched pinned specifications, CTS fixtures, and demo, and prepared the deterministic demo adapter.');

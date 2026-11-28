import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { contrast, stats } from './browser-baseline-metrics.mjs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const suite = read(new URL('../benchmarks/browser-baseline-v1.json', import.meta.url));
const reviewedImage = read(new URL('../benchmarks/browser-baseline-v1-images.json', import.meta.url));
const fingerprint = value => createHash('sha256').update(value).digest('hex');
const [directory, referenceDirectory, noiseComparison] = process.argv.slice(2);
assert(directory, 'Pass a campaign directory, optional reference directory and optional A/A comparison.json');
const env = read(join(directory, 'external/environment.json'));
const heavy = read(join(directory, 'three/environment.json'));
assert.deepEqual(env.selected, Object.keys(suite.externalDraws));
assert.deepEqual(env.backends, suite.routes);
assert.deepEqual([...heavy.scenes].sort(), [...suite.three].sort());
for (const settings of [env, heavy]) {
  for (const key of ['rounds', 'warmup', 'samples']) assert.equal(settings[key], suite[key]);
}
assert.equal(heavy.headless, true);
assert.equal(heavy.revision, env.revision);
for (const path of ['artifacts/compiler/compiler.wasm', 'artifacts/core-wasm/refral_core.wasm']) {
  assert.equal(env.hashes[path], heavy.hashes[path]);
}

function diff(left, right) {
  assert.deepEqual([left.width, left.height], [right.width, right.height]);
  let aboveTwo = 0;
  for (let index = 0; index < left.data.length; index += 4) {
    if ([0, 1, 2].some(channel => Math.abs(left.data[index + channel] - right.data[index + channel]) > 2)) aboveTwo++;
  }
  return { aboveTwo, pixels: left.width * left.height };
}

const environment = { browser: heavy.browser, cpu: env.hardware, os: env.os, node: env.node, fixtures: env.revisions,
  fixtureHashes: Object.fromEntries(Object.entries({ ...env.hashes, ...heavy.hashes }).filter(([name]) => !name.endsWith('.wasm'))) };
const reference = referenceDirectory && read(join(referenceDirectory, 'summary.json'));
const noise = noiseComparison && read(noiseComparison);
const binaries = Object.fromEntries(Object.entries(env.hashes).filter(([path]) => path.endsWith('.wasm')));
if (reference) {
  assert.deepEqual(reference.environment, environment, 'Incompatible measurement environment');
  assert.deepEqual(reference.suite, suite, 'Incompatible suite');
}
if (noise) {
  assert(reference, 'The noise control requires a reference campaign');
  assert.equal(noise.revision, noise.referenceRevision, 'Noise control must be A/A');
  assert.deepEqual(noise.binaries, noise.referenceBinaries, 'A/A build mismatch');
  assert.deepEqual(noise.review, [], 'A/A control needs review');
  assert.deepEqual(noise.environment, environment);
  assert.deepEqual(noise.suite, suite);
}
const rows = {};
const review = [];
for (const scene of [...Object.keys(suite.externalDraws), ...suite.three]) {
  const external = Object.hasOwn(suite.externalDraws, scene);
  const values = Object.fromEntries(suite.routes.map(route => [route, []]));
  for (let round = 1; round <= suite.rounds; round++) {
    let nativeImage, nativeWork, jsImage;
    for (const route of suite.routes) {
      const key = `${scene}/${route}`;
      const row = rows[key] ??= { rounds: [] };
      const stem = join(directory, external ? 'external' : 'three', `${external ? '' : 'round-'}${round}-${scene}-${route}`);
      const raw = read(stem + '.json');
      assert.deepEqual([raw.round, raw.name ?? raw.scene, raw.backend, raw.errors], [round, scene, route, []]);
      const measurement = external ? raw.measurement : raw.result;
      if (external) {
        assert.deepEqual([raw.status, raw.browser, raw.warmup, raw.samples, measurement.auditDraws],
          ['pass', heavy.browser, suite.warmup, suite.samples, suite.externalDraws[scene]]);
      }
      assert.deepEqual([measurement.glError, measurement.core ?? measurement.selectedCore,
        measurement.errors ?? measurement.gpuErrors], [0, route, []]);
      if (route === 'native') assert.doesNotMatch(measurement.adapter.renderer ?? measurement.adapter, /swiftshader|llvmpipe|software rasterizer/i);
      else assert.equal(measurement.adapter.isFallbackAdapter, false);
      const samples = external ? measurement.cpu : measurement.frames.map(frame => frame.cpuMs);
      assert.equal(samples.length, suite.samples);
      const work = fingerprint(JSON.stringify([measurement.width, measurement.height, external
        ? [measurement.auditDraws, measurement.auditUniforms] : measurement.frames.map(({ seconds, calls, triangles, lines, points }) => [seconds, calls, triangles, lines, points])]));
      const image = PNG.sync.read(readFileSync(stem + '.png'));
      if (route === 'native') { nativeWork = work; nativeImage = image; }
      assert.equal(work, nativeWork, `Unequal work: ${key}`);
      assert(image.data.some((value, index) => index % 4 < 3 && value !== image.data[index % 4]), `Flat image: ${key}`);
      const nativeDiff = diff(nativeImage, image);
      const knownAquarium = scene === 'aquarium' || scene === 'aquarium-20k';
      if (!knownAquarium) assert(nativeDiff.aboveTwo / nativeDiff.pixels < 0.002, `Native image mismatch: ${key}`);
      if (route === 'js') jsImage = image;
      if (knownAquarium && route === 'rust') assert(image.data.equals(jsImage.data), `Unequal cores: ${key}`);
      const capture = fingerprint(image.data);
      row.rounds.push({ cpu: stats(samples), work, capture, nativeDiff, adapter: measurement.adapter });
      values[route].push(...samples);
      if (reference) {
        const before = reference.rows[key].rounds[round - 1];
        assert.equal(work, before.work, `Work changed: ${key}`);
        assert.deepEqual(measurement.adapter, before.adapter, `Adapter changed: ${key}`);
        if (capture !== before.capture) {
          const known = reference.rows[key].rounds.some(entry => entry.capture === capture);
          const reviewed = ['browser', 'cpu', 'os'].every(field => environment[field] === reviewedImage[field])
            && reviewedImage.alternates.find(entry => entry.cells.includes(key) && [before.capture, capture].every(hash => entry.captures.includes(hash)));
          row.rounds.at(-1).imageChange = known ? 'exact known same-route pose' : reviewed ? reviewed.reason : 'unseen capture';
          if (!known && !reviewed) review.push(`Inspect same-route image: ${key}, round ${round}`);
        }
      }
    }
  }
  for (const route of suite.routes) {
    const key = `${scene}/${route}`;
    const row = rows[key];
    row.cpu = stats(values[route]);
    if (reference) {
      const before = reference.rows[key];
      Object.assign(row, contrast(row, before, noise?.rows[key].maxObservedDeltaMs, route === 'native'));
      row.repeat.forEach((repeat, index) => {
        if (repeat) review.push(`Repeat timing: ${key} ${index === 0 ? 'p50' : 'p95'} delta ${row.deltaMs[index].toFixed(3)} ms/frame`);
      });
    }
  }
}
const report = { suite, revision: env.revision, binaries, environment, rows, review, referenceDirectory,
  referenceRevision: reference?.revision, referenceBinaries: reference?.binaries, noiseComparison };
writeFileSync(join(directory, reference ? 'comparison.json' : 'summary.json'), JSON.stringify(report, null, 2) + '\n');
for (const message of review) console.warn(message);
console.log(`Verified ${Object.keys(rows).length} cells. CPU metric: pooled p50/p95 ms/frame. Review items: ${review.length}`);
if (review.length) process.exitCode = 1;

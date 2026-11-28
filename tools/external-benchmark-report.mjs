import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const directory = process.argv[2];
assert(directory, 'Pass a benchmark result directory');
const results = readdirSync(directory).filter(file => /^\d+-.*\.json$/.test(file))
  .map(file => JSON.parse(readFileSync(join(directory, file), 'utf8')));
assert(results.length, 'No result files');
const names = [...new Set(results.map(row => row.name))].sort();

function percentiles(values) {
  values.sort((a, b) => a - b);
  return [0.5, 0.95].map(q => values[Math.ceil(values.length * q) - 1]);
}

function compareImages(left, right) {
  assert.equal(left.width, right.width);
  assert.equal(left.height, right.height);
  let different = 0;
  let aboveTwo = 0;
  for (let i = 0; i < left.data.length; i += 4) {
    let delta = 0;
    for (let c = i; c < i + 3; c++) delta = Math.max(delta, Math.abs(left.data[c] - right.data[c]));
    if (delta) different++;
    if (delta > 2) aboveTwo++;
  }
  return { different, aboveTwo, pixels: left.width * left.height };
}

const summary = {};
for (const name of names) {
  const cases = results.filter(row => row.name === name);
  const group = {};
  for (const backend of new Set(cases.map(row => row.backend))) {
    const rows = cases.filter(row => row.backend === backend).sort((a, b) => a.round - b.round);
    const failed = rows.filter(row => row.status !== 'pass');
    if (failed.length || name === 'unity') {
      group[backend] = rows.map(row => ({ round: row.round, failure: row.failure, scores: row.scores }));
      continue;
    }
    const images = [];
    for (const row of rows) {
      const m = row.measurement;
      assert(m.cpu.length === row.samples && m.intervals.length === row.samples);
      assert([...m.cpu, ...m.intervals].every(Number.isFinite));
      const reference = cases.find(n => n.round === row.round && n.backend === 'native' && n.status === 'pass');
      if (!reference) continue;
      const ref = reference.measurement;
      assert.deepEqual([m.auditDraws, m.width, m.height, row.warmup, row.samples, row.browser],
        [ref.auditDraws, ref.width, ref.height, reference.warmup, reference.samples, reference.browser]);
      const png = route => PNG.sync.read(readFileSync(join(directory, [row.round, name, route].join('-') + '.png')));
      const image = png(backend);
      assert(new Set(new Uint32Array(image.data.buffer, image.data.byteOffset, image.data.length / 4)).size > 1,
        'Uniform screenshot for ' + name);
      const diff = { round: row.round, native: compareImages(image, png('native')) };
      if (backend === 'rust' && cases.some(r => r.round === row.round && r.backend === 'js' && r.status === 'pass'))
        diff.js = compareImages(image, png('js'));
      images.push(diff);
    }
    group[backend] = {
      rounds: rows.length, frames: rows.reduce((sum, row) => sum + row.samples, 0),
      draws: rows.map(row => row.measurement.auditDraws),
      cpu: percentiles(rows.flatMap(row => row.measurement.cpu)),
      intervals: percentiles(rows.flatMap(row => row.measurement.intervals)), images,
    };
  }
  summary[name] = group;
}
console.log(JSON.stringify(summary, null, 2));

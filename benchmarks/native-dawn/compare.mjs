import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { uniformSweep } from '../../tools/animometer-uniform-sweep.mjs';

const [baseline, output] = process.argv.slice(2);
assert(baseline && output, 'Usage: compare.mjs BROWSER_BASELINE NEW_OUTPUT');
fs.mkdirSync(output);
const chrome = JSON.parse(fs.readFileSync(join(baseline, 'environment.json'), 'utf8'));
const hashes = {};
for (const file of [
  'artifacts/compiler/compiler.wasm',
  'tools/animometer-uniform-sweep.mjs',
  'artifacts/native-dawn/animometer.node',
  'artifacts/native-dawn/libprobe_angle.dylib',
]) {
  hashes[file] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (chrome.hashes[file]) assert.equal(hashes[file], chrome.hashes[file], file);
}
const environment = {
  baseline,
  chromeRevision: chrome.revision,
  hashes,
  node: process.version,
  v8: process.versions.v8,
};
fs.writeFileSync(join(output, 'environment.json'), JSON.stringify(environment, null, 2));
const backends = ['calibration', 'rust', 'angle'];
const images = [];
for (let round = 1; round <= 3; round++) {
  for (const name of [...uniformSweep.keys(), 'animometer']) {
    const prefix = round + '-' + name + '-';
    const reference = PNG.sync.read(fs.readFileSync(join(baseline, prefix + 'native.png')));
    const runs = backends
      .map((_, i) => backends[(i + round - 1) % backends.length])
      .flatMap((backend) => {
        const modes =
          name === 'animometer'
            ? round % 2
              ? ['default', 'fallback']
              : ['fallback', 'default']
            : ['default'];
        return modes.map((mode) => ({ backend, mode }));
      });
    for (const { backend, mode } of runs) {
      const stem = join(output, prefix + backend + (mode === 'fallback' ? '-fallback' : ''));
      const flags = mode === 'fallback' ? ['--no-turbo-fast-api-calls'] : [];
      execFileSync(
        process.execPath,
        [...flags, 'benchmarks/native-dawn/run.mjs', backend, name, stem],
        {
          stdio: 'inherit',
        },
      );
      if (backend === 'calibration') continue;
      const image = PNG.sync.read(fs.readFileSync(stem + '.png'));
      assert.equal(image.width, reference.width);
      assert.equal(image.height, reference.height);
      let different = 0,
        overTwo = 0,
        maxDelta = 0;
      for (let offset = 0; offset < image.data.length; offset += 4) {
        let delta = 0;
        for (let c = 0; c < 3; c++)
          delta = Math.max(delta, Math.abs(image.data[offset + c] - reference.data[offset + c]));
        if (delta) different++;
        if (delta > 2) overTwo++;
        maxDelta = Math.max(delta, maxDelta);
      }
      images.push({ round, name, backend, mode, different, overTwo, maxDelta });
      fs.writeFileSync(join(output, 'images.json'), JSON.stringify(images, null, 2));
      assert(
        overTwo <= 0.002 * image.width * image.height,
        stem + ' exceeded the task 137 pixel tolerance',
      );
    }
  }
}

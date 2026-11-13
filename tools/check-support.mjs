import { readFile } from 'node:fs/promises';

const matrix = JSON.parse(await readFile('docs/support.json', 'utf8'));
const states = new Set(['unimplemented', 'implemented-unverified', 'differential-verified', 'cts-verified']);
const identities = new Set();
if (matrix.version !== 2 || matrix.defaultCore !== 'js' || !matrix.cores.js || !matrix.cores.rust) {
  throw new Error('The support matrix requires the version 2 per-core schema.');
}
for (const entry of matrix.entries) {
  if (identities.has(entry.id)) throw new Error(`Duplicate support identity ${entry.id}`);
  identities.add(entry.id);
  if (!entry.api) throw new Error(`Missing API ${entry.id}`);
  for (const core of Object.keys(matrix.cores)) {
    const result = entry.cores?.[core];
    if (!result || !states.has(result.status)) throw new Error(`Invalid support state ${entry.id}/${core}`);
    if (!result.coverage || !result.unsupportedBehavior || !Array.isArray(result.tests) || !Array.isArray(result.evidence)) {
      throw new Error(`Incomplete support entry ${entry.id}/${core}`);
    }
    if (['differential-verified', 'cts-verified'].includes(result.status) && result.tests.length === 0) {
      throw new Error(`Verified entry requires tests ${entry.id}/${core}`);
    }
  }
}
console.log(`Validated ${matrix.entries.length} support entries for ${Object.keys(matrix.cores).join(' and ')}.`);

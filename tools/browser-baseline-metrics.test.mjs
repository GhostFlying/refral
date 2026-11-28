import assert from 'node:assert/strict';
import test from 'node:test';
import { contrast, stats } from './browser-baseline-metrics.mjs';

const sample = (cpu, rounds) => ({ cpu, rounds: rounds.map(pair => ({ cpu: pair })) });
const before = sample([2, 3], [[2, 3], [2, 3], [2, 3]]);

test('nearest rank uses every frame and rejects missing or invalid times', () => {
  assert.deepEqual(stats(Array.from({ length: 20 }, (_, index) => 20 - index)), [10, 19]);
  for (const bad of [[], [NaN], [Infinity], [-1]]) assert.throws(() => stats(bad));
});

test('noise includes paired outliers; a repeat needs both excess and majority', () => {
  const after = sample([3, 4], [[1, 9], [4, 1], [3, 2]]);
  assert.deepEqual(contrast(after, before, [0.5, 0.5], false), {
    deltaMs: [1, 1], maxObservedDeltaMs: [2, 6], repeat: [true, false],
  });
  assert.deepEqual(contrast(after, before, [1, 1], false).repeat, [false, false]);
});

test('a faster native sentinel is drift; a faster candidate is not a regression', () => {
  const faster = sample([1, 2], [[1, 2], [1, 2], [1, 2]]);
  assert.deepEqual(contrast(faster, before, [0.5, 0.5], true).repeat, [true, true]);
  assert.deepEqual(contrast(faster, before, [0.5, 0.5], false).repeat, [false, false]);
});

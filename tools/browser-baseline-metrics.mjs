import assert from 'node:assert/strict';

export function stats(values) {
  assert(values.length && values.every(value => Number.isFinite(value) && value >= 0));
  const sorted = values.toSorted((left, right) => left - right);
  return [0.5, 0.95].map(quantile => sorted[Math.ceil(sorted.length * quantile) - 1]);
}

export function contrast(after, before, noise, sentinel) {
  const deltaMs = after.cpu.map((value, index) => value - before.cpu[index]);
  const paired = after.rounds.map((sample, round) => sample.cpu.map((value, index) => value - before.rounds[round].cpu[index]));
  const maxObservedDeltaMs = deltaMs.map((value, index) => Math.max(Math.abs(value), ...paired.map(pair => Math.abs(pair[index]))));
  const repeat = deltaMs.map((delta, index) => !!noise && (sentinel ? Math.abs(delta) : delta) > noise[index]
    && paired.filter(pair => Math.sign(pair[index]) === Math.sign(delta)).length > paired.length / 2);
  return { deltaMs, maxObservedDeltaMs, repeat };
}

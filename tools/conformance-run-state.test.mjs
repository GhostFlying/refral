import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conformanceFingerprint, validateConformanceCheckpoint } from './conformance-run-state.mjs';

test('checkpoint fingerprint covers runtime, adapter, compiler, browser and revision changes', () => {
  const configuration = { runtimeRevision: 'one', hashes: { 'core.ts': 'dirty-source-a', 'core.wasm': 'binary-a', 'adapter.ts': 'adapter-a' } };
  const original = conformanceFingerprint(configuration, '157');
  assert.equal(conformanceFingerprint(configuration, '157'), original);
  assert.notEqual(conformanceFingerprint(configuration, '158'), original);
  assert.notEqual(conformanceFingerprint({ ...configuration, runtimeRevision: 'two' }, '157'), original);
  for (const file of Object.keys(configuration.hashes)) {
    assert.notEqual(conformanceFingerprint({ ...configuration,
      hashes: { ...configuration.hashes, [file]: 'changed' } }, '157'), original);
  }
});

test('resume checks backend, index, URL and uniqueness before accepting completed files', () => {
  const checkpoint = { fingerprint: 'same', backend: 'js', inventory: ['a.html', 'b.html'],
    results: [{ backend: 'js', index: 1, url: 'b.html' }] };
  validateConformanceCheckpoint(checkpoint, 'js', 'same');
  assert.throws(() => validateConformanceCheckpoint(checkpoint, 'rust', 'same'), /backend/);
  assert.throws(() => validateConformanceCheckpoint(checkpoint, 'js', 'different'), /configuration changed/);
  const invalidRecords = [
    { backend: 'rust', index: 1, url: 'b.html' }, { backend: 'js', index: 0, url: 'b.html' },
    { backend: 'js', index: -1, url: 'a.html' }, { backend: 'js', index: 2, url: 'b.html' },
  ];
  for (const record of invalidRecords) {
    assert.throws(() => validateConformanceCheckpoint({ ...checkpoint, results: [record] }, 'js', 'same'), /identity/);
  }
  assert.throws(() => validateConformanceCheckpoint({ ...checkpoint,
    results: [...checkpoint.results, ...checkpoint.results] }, 'js', 'same'), /identity/);
  assert.throws(() => validateConformanceCheckpoint({ ...checkpoint,
    inventory: ['a.html', 'a.html'] }, 'js', 'same'), /inventory/);
});

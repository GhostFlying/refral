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

test('a stalled protocol close escalates to the same browser server and records its exit', async () => {
  const { closeConformanceBrowser } = await import('./conformance-browser.mjs');
  const child = { exitCode: null, signalCode: null };
  const calls = [];
  const server = { process: () => child, close: () => { calls.push('close'); return new Promise(() => {}); },
    kill: async () => { calls.push('kill'); child.signalCode = 'SIGKILL'; } };
  const launch = {};
  const deadline = async (promise, _ms, label) => {
    if (label.includes('graceful')) throw new Error('simulated protocol stall');
    return promise;
  };
  await closeConformanceBrowser(server, launch, deadline);
  assert.deepEqual(calls, ['close', 'kill']);
  assert.equal(launch.forced, true);
  assert.equal(launch.signal, 'SIGKILL');
  assert.match(launch.gracefulCloseError, /simulated protocol stall/);
});

test('cleanup verifies the owned process really exited before starting the next browser', async () => {
  const { closeConformanceBrowser } = await import('./conformance-browser.mjs');
  const child = { exitCode: null, signalCode: null };
  const server = { process: () => child, close: async () => {} };
  await assert.rejects(closeConformanceBrowser(server, {}, promise => promise), /still running/);
  child.exitCode = 0;
  const launch = {};
  await closeConformanceBrowser(server, launch, promise => promise);
  assert.equal(launch.exitCode, 0);
  assert.equal(launch.forced, undefined);
});

test('an exited owned process with a pending launcher promise releases its pipes', { skip: process.platform === 'win32' }, async () => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { closeConformanceBrowser } = await import('./conformance-browser.mjs');
  const child = spawn(process.execPath, ['-e', ''], { detached: true, stdio: 'pipe' });
  await once(child, 'exit');
  const server = { process: () => child, close: () => new Promise(() => {}), kill: () => new Promise(() => {}) };
  const launch = {};
  await closeConformanceBrowser(server, launch, async (_promise, _ms, message) => { throw new Error(message); });
  assert.equal(launch.exitCode, 0);
  assert.match(launch.cleanupDelay, /cleanup is still pending/);
  assert.ok(child.stdio.every(pipe => !pipe || pipe.destroyed));
});

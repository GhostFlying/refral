import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { BACKENDS, buildConformanceReport, writeConformanceReport } from './conformance-report.mjs';

const execFileAsync = promisify(execFile);

function result(url, index, backend, overrides = {}) {
  return { index, url, backend, status: 'pass', completion: 'finished', passed: 2, failed: 0, skipped: 0,
    failures: [], failuresTruncated: 0, errors: [], contexts: [], adapterGaps: [], durationMs: 1, ...overrides };
}

function runs(inventory) {
  return Object.fromEntries(BACKENDS.map(backend => [backend, {
    inventory: [...inventory], results: inventory.map((url, index) => result(url, index, backend)),
    environment: { ctsRevision: 'pinned-revision', headless: true },
  }]));
}

function build(inputs, count = inputs.native.inventory.length) {
  return buildConformanceReport(inputs, { expectedInventoryCount: count });
}

test('the official denominator counts unique HTML files independently from backend executions and assertions', () => {
  const inventory = Array.from({ length: 971 }, (_, index) => `conformance/textures/case-${index}.html`);
  const { summary } = buildConformanceReport(runs(inventory));
  assert.equal(summary.complete, true);
  assert.equal(summary.officialInventoryFiles, 971);
  assert.equal(summary.expectedBackendFileExecutions, 2913);
  assert.equal(summary.files.length, 2913);
  for (const backend of BACKENDS) {
    assert.equal(summary.backends[backend].expectedFiles, 971);
    assert.equal(summary.backends[backend].effectiveFileStatuses.pass, 971);
    assert.equal(summary.backends[backend].assertions.passed, 1942);
    assert.equal(summary.backends[backend].noGlContextFiles, 971);
  }
});

test('missing backend files and individual URLs remain in every official denominator', () => {
  const inventory = ['conformance/state/a.html', 'conformance/state/b.html'];
  const inputs = runs(inventory);
  inputs.js.results.pop();
  delete inputs.rust;
  const { summary, clusters } = build(inputs);
  assert.equal(summary.complete, false);
  assert.equal(summary.backends.js.missingFiles, 1);
  assert.equal(summary.backends.rust.missingFiles, 2);
  assert.equal(summary.backends.rust.effectiveFileStatuses.missing, 2);
  assert.deepEqual(summary.files.filter(file => file.backend === 'rust').map(file => file.url), inventory);
  const missing = clusters.clusters.find(cluster => cluster.id === 'missing-results');
  assert.equal(missing.uniqueHtmlFiles, 2);
  assert.equal(missing.backendFileExecutions, 3);
});

test('short, duplicated and inconsistent inventories are explicit input issues', () => {
  const inputs = runs(['conformance/state/a.html', 'conformance/state/b.html']);
  inputs.js.inventory.push(inputs.js.inventory[0]);
  inputs.rust.inventory.reverse();
  const { summary } = build(inputs, 3);
  assert.equal(summary.complete, false);
  assert.equal(summary.backends.native.expectedFiles, 3);
  assert.equal(summary.backends.native.missingFiles, 1);
  assert.equal(summary.backends.native.unidentifiedInventoryFiles, 1);
  assert.ok(summary.inputIssues.some(issue => issue.kind === 'inventory-count'));
  assert.ok(summary.inputIssues.some(issue => issue.kind === 'duplicate-inventory'));
  assert.ok(summary.inputIssues.some(issue => issue.backend === 'rust' && issue.kind === 'inventory-mismatch'));
  assert.throws(() => buildConformanceReport({}), /No official inventory/);
});

test('duplicate and unknown result URLs never inflate file or assertion counts', () => {
  const inputs = runs(['conformance/buffers/a.html']);
  inputs.js.results.push({ ...inputs.js.results[0], passed: 99 });
  inputs.js.results.push(result('conformance/buffers/unknown.html', 1, 'js'));
  const { summary } = build(inputs);
  assert.equal(summary.backends.js.uniqueReportedFiles, 1);
  assert.equal(summary.backends.js.reportedRecords, 3);
  assert.equal(summary.backends.js.duplicateRecords, 1);
  assert.equal(summary.backends.js.assertions.passed, 2);
  assert.equal(summary.backends.js.effectiveFileStatuses['harness-error'], 1);
  assert.equal(summary.files.find(file => file.backend === 'js').originalStatus, 'pass');
  assert.ok(summary.inputIssues.some(issue => issue.kind === 'unknown-result-url'));
});

test('an official URL with an incorrect index invalidates the result identity', () => {
  const inputs = runs(['conformance/state/a.html', 'conformance/state/b.html']);
  inputs.js.results[0].index = 1;
  const { summary } = build(inputs);
  assert.equal(summary.complete, false);
  assert.equal(summary.backends.js.effectiveFileStatuses['harness-error'], 1);
  assert.ok(summary.inputIssues.some(issue => issue.backend === 'js'
    && issue.messages?.includes('index does not match its official inventory URL')));
});

test('status, count, completion and backend contradictions invalidate a record while preserving its original status', () => {
  const inventory = ['conformance/state/a.html', 'conformance/state/b.html', 'conformance/state/c.html'];
  const inputs = runs(inventory);
  inputs.js.results[0].status = 'unexpected';
  inputs.js.results[1].failed = 1;
  inputs.js.results[2].completion = 'crash';
  inputs.rust.results[0].backend = 'js';
  inputs.rust.results[1].passed = -1;
  inputs.rust.results[2].status = 'timeout';
  const { summary } = build(inputs);
  assert.equal(summary.complete, false);
  assert.equal(summary.backends.js.originalFileStatuses.invalid, 1);
  assert.equal(summary.backends.js.effectiveFileStatuses['harness-error'], 3);
  assert.equal(summary.backends.rust.effectiveFileStatuses['harness-error'], 3);
  assert.equal(summary.files.find(file => file.backend === 'js').originalStatus, 'unexpected');
});

test('all six supported statuses remain distinct and ordinary conformance failures complete the baseline', () => {
  const states = ['pass', 'fail', 'skip', 'unsupported', 'timeout', 'harness-error'];
  const inputs = runs(states.map(status => `conformance/state/${status}.html`));
  for (const backend of BACKENDS) {
    for (const [index, status] of states.entries()) {
      inputs[backend].results[index].status = status;
      if (status === 'timeout') inputs[backend].results[index].completion = 'timeout';
      if (status === 'harness-error') inputs[backend].results[index].completion = 'crash';
    }
  }
  const { summary } = build(inputs);
  assert.equal(summary.complete, true);
  for (const backend of BACKENDS) {
    for (const status of states) {
      assert.equal(summary.backends[backend].originalFileStatuses[status], 1);
      assert.equal(summary.backends[backend].effectiveFileStatuses[status], 1);
    }
  }
});

test('retained failure messages and truncation are counted separately from failed assertions', () => {
  const inputs = runs(['conformance/textures/mipmap.html']);
  const failures = Array.from({ length: 200 }, (_, index) => `original failure ${index}`);
  Object.assign(inputs.js.results[0], { status: 'fail', failed: 205, failures, failuresTruncated: 5 });
  const { summary } = build(inputs);
  assert.equal(summary.complete, true);
  assert.equal(summary.backends.js.assertions.failed, 205);
  assert.equal(summary.backends.js.assertions.retainedFailureMessages, 200);
  assert.equal(summary.backends.js.assertions.truncatedFailureMessages, 5);
  assert.equal(summary.files.find(file => file.backend === 'js').evidence[0].message, 'original failure 0');
  inputs.js.results[0].failuresTruncated = -1;
  assert.equal(build(inputs).summary.complete, false);
  inputs.js.results[0].failuresTruncated = 0;
  inputs.js.results[0].failures.push('over limit');
  assert.equal(build(inputs).summary.complete, false);
  inputs.js.results[0].failures = ['one original failure'];
  inputs.js.results[0].failuresTruncated = 0.5;
  assert.equal(build(inputs).summary.complete, false);
});

test('case captures are included without changing assertion results', () => {
  const inputs = runs(['conformance/textures/capture.html']);
  const screenshot = { kind: 'case-page', file: 'native/screenshots/0000.png', width: 800, height: 500,
    canvas: { id: 'example', x: 0, y: 0, width: 32, height: 32 } };
  const unavailable = { kind: 'unavailable', message: 'Capture timed out' };
  inputs.native.results[0].screenshot = screenshot;
  Object.assign(inputs.js.results[0], { status: 'fail', failed: 1, screenshot: unavailable });
  const { summary } = build(inputs);
  assert.equal(summary.complete, true);
  assert.deepEqual(summary.files[0].screenshot, screenshot);
  assert.deepEqual(summary.files[1].screenshot, unavailable);
  assert.equal(summary.files[1].effectiveStatus, 'fail');
  assert.equal(summary.files[2].screenshot, undefined);
});

test('official skipped failures overlap raw counters and do not inflate distinct assertion totals or effective failures', () => {
  const inputs = runs(['conformance/state/skipped.html']);
  Object.assign(inputs.js.results[0], { passed: 5, failed: 2, skipped: 3,
    skippedFailures: 2, assertionTimeouts: 0, failures: ['skipped failure one', 'skipped failure two'] });
  Object.assign(inputs.rust.results[0], { status: 'fail', passed: 4, failed: 3, skipped: 2,
    skippedFailures: 1, assertionTimeouts: 2, failures: ['one', 'two', 'three'] });
  const { summary } = build(inputs);
  assert.equal(summary.complete, true);
  assert.equal(summary.backends.js.effectiveFileStatuses.pass, 1);
  assert.equal(summary.backends.js.assertions.totalAssertions, 7);
  assert.equal(summary.backends.js.assertions.failed, 2);
  assert.equal(summary.backends.js.assertions.effectiveFailed, 0);
  assert.equal(summary.backends.rust.assertions.totalAssertions, 9);
  assert.equal(summary.backends.rust.assertions.effectiveFailed, 2);
  assert.equal(summary.backends.rust.assertions.skipped, 2);
  inputs.js.results[0].skippedFailures = 3;
  assert.equal(build(inputs).summary.complete, false);
});

test('provenance mismatches and worker adapter gaps cannot become selected-core passes', () => {
  const inputs = runs(['conformance/context/a.html', 'conformance/context/b.html']);
  inputs.js.results[0].contexts = [{ requestedCore: 'js', actualCore: 'native', kind: 'webgl', attributes: {}, adapter: {} }];
  inputs.rust.results[0].contexts = [{ requestedCore: 'rust', actualCore: 'rust', kind: 'webgl', attributes: {}, adapter: {} }];
  inputs.rust.results[1].adapterGaps = [{ kind: 'worker', message: 'Worker WebGL context provenance unavailable', url: 'worker.js' }];
  const { summary, clusters } = build(inputs);
  assert.equal(summary.complete, true);
  assert.equal(summary.backends.js.originalFileStatuses.pass, 2);
  assert.equal(summary.backends.js.effectiveFileStatuses.pass, 1);
  assert.equal(summary.backends.js.provenanceMismatchFiles, 1);
  assert.equal(summary.backends.rust.effectiveFileStatuses.unsupported, 1);
  assert.equal(summary.backends.rust.adapterGapFiles, 1);
  assert.equal(clusters.clusters.find(cluster => cluster.id === 'adapter-provenance').backendFileExecutions, 2);
  assert.equal(summary.files.find(file => file.backend === 'js').paired.native.effectiveStatus, 'pass');
});

test('failure clusters retain transparent overlapping rules and paired native observations', () => {
  const inputs = runs(['conformance/textures/mipmap.html']);
  Object.assign(inputs.native.results[0], { status: 'fail', failed: 1, failures: ['INVALID_ENUM from generateMipmap'] });
  Object.assign(inputs.js.results[0], { status: 'unsupported', errors: [{ kind: 'exception', name: 'NotSupportedError',
    message: 'generateMipmap is outside the implemented WebGL1 profile', url: 'fixture.js' }] });
  const { summary, clusters } = build(inputs);
  assert.equal(summary.complete, true);
  assert.equal(clusters.countsOverlap, true);
  assert.ok(clusters.rules.find(rule => rule.id === 'texture-images').evidencePattern.includes('generateMipmap'));
  const texture = clusters.clusters.find(cluster => cluster.id === 'texture-images');
  assert.equal(texture.uniqueHtmlFiles, 1);
  assert.equal(texture.backendFileExecutions, 2);
  assert.deepEqual(texture.backends, { native: 1, js: 1, rust: 0 });
  const native = clusters.clusters.find(cluster => cluster.id === 'native-observation').files[0];
  assert.equal(native.paired.rust.originalStatus, 'pass');
  assert.equal(native.matchedEvidence[0].message, 'INVALID_ENUM from generateMipmap');
  assert.ok(clusters.clusters.some(cluster => cluster.id === 'profile-diagnostic'));
  assert.equal(summary.modules.find(group => group.backend === 'native').module, 'conformance/textures');
});

test('the CLI writer reads backend result paths and emits bounded JSON and Markdown summaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'refral-conformance-report-'));
  try {
    const inventory = Array.from({ length: 971 }, (_, index) => `conformance/state/case-${index}.html`);
    const inputs = runs(inventory);
    for (const backend of BACKENDS) {
      await mkdir(join(directory, backend));
      await writeFile(join(directory, backend, 'results.json'), JSON.stringify(inputs[backend]));
    }
    const output = join(directory, 'reports');
    const result = await writeConformanceReport({ inputDirectory: directory, outputDirectory: output });
    assert.equal(result.summary.complete, true);
    assert.equal(JSON.parse(await readFile(join(output, 'summary.json'), 'utf8')).expectedBackendFileExecutions, 2913);
    assert.deepEqual(JSON.parse(await readFile(join(output, 'failure-clusters.json'), 'utf8')).clusters, []);
    const markdown = await readFile(join(output, 'summary.md'), 'utf8');
    assert.match(markdown, /971 unique HTML files/);
    assert.match(markdown, /conformance\/state \| 971 \| 971 \| 971 \| 971/);
    const cliOutput = join(directory, 'cli-report');
    const cli = await execFileAsync(process.execPath, ['tools/conformance-report.mjs', '--input', directory, '--output', cliOutput]);
    assert.match(cli.stdout, /Collection complete/);
    assert.equal(JSON.parse(await readFile(join(cliOutput, 'summary.json'), 'utf8')).complete, true);
    const help = await execFileAsync(process.execPath, ['tools/conformance-report.mjs', '--help']);
    assert.match(help.stdout, /--input directory/);
    await assert.rejects(execFileAsync(process.execPath, ['tools/conformance-report.mjs', '--input', '--output']), /Invalid report argument/);
    const source = JSON.parse(await readFile(join(directory, 'js', 'results.json'), 'utf8'));
    assert.equal(source.results[0].status, 'pass');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test('an external browser timeout retains the file denominator and exposes unavailable partial counters', () => {
  const inputs = runs(['conformance/glsl/hung.html']);
  inputs.js.results[0] = result(inputs.js.inventory[0], 0, 'js', {
    status: 'timeout', completion: 'crash', passed: 0, partialCountsUnavailable: true,
    errors: [{ kind: 'recovery', name: 'Error', message: 'Conformance page stopped responding.' }],
  });
  const { summary } = build(inputs);
  assert.equal(summary.complete, true);
  assert.equal(summary.backends.js.effectiveFileStatuses.timeout, 1);
  assert.equal(summary.backends.js.partialAssertionCountFiles, 1);
  assert.equal(summary.files.find(file => file.backend === 'js').assertionCountsComplete, false);
});


test('original inner assertion timeouts and known profile barriers retain their evidence', () => {
  const inputs = runs(['conformance/glsl/inner-timeout.html']);
  inputs.js.results[0] = result(inputs.js.inventory[0], 0, 'js', {
    status: 'timeout', completion: 'finished', passed: 1, assertionTimeouts: 1,
    errors: [{ kind: 'page', name: 'NotSupportedError', message: 'non-triangle draw is outside the implemented profile' }],
  });
  const { summary } = build(inputs);
  assert.equal(summary.complete, true);
  assert.equal(summary.backends.js.timeoutsWithProfileDiagnostics, 1);
  assert.equal(summary.backends.js.assertions.totalAssertions, 2);
});


test('capability barriers retain exact observed counters and disclose unfinished original scripts', () => {
  const inputs = runs(['conformance/ogles/blocked.html']);
  inputs.js.results[0] = result(inputs.js.inventory[0], 0, 'js', {
    status: 'unsupported', completion: 'capability-error', passed: 0, capabilityTerminated: true,
    errors: [{ kind: 'page', name: 'NotSupportedError', message: 'non-triangle draw is outside the implemented profile' }],
  });
  const { summary } = build(inputs);
  assert.equal(summary.complete, true);
  assert.equal(summary.backends.js.capabilityTerminatedFiles, 1);
  assert.equal(summary.backends.js.effectiveFileStatuses.unsupported, 1);
  const file = summary.files.find(file => file.backend === 'js');
  assert.equal(file.observedCountersComplete, true);
  assert.equal(file.originalTestCompleted, false);
  assert.equal(file.capabilityTerminated, true);
});

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKENDS = ['native', 'js', 'rust'];
export const STATUSES = ['pass', 'fail', 'skip', 'unsupported', 'timeout', 'harness-error'];
const DEFAULT_DIRECTORY = 'artifacts/conformance/baseline';
const FAILURE_LIMIT = 200;

// Rules group retained evidence. They identify dependency candidates for a later
// spec audit and do not determine whether an assertion or a browser is correct.
export const DEPENDENCY_RULES = [
  { id: 'context-initialization', priority: 1, title: 'Context, device and artifact initialization',
    pattern: /requestAdapter|requestDevice|WebGPU|device (?:lost|creation)|Wasm|WebAssembly|compiler.*(?:load|initializ)|initializ.*(?:context|compiler)/i,
    dependsOn: ['adapter-provenance'], reference: 'docs/architecture.md' },
  { id: 'profile-diagnostic', priority: 2, title: 'Explicit implementation profile diagnostics',
    pattern: /NotSupportedError|outside (?:the )?(?:implemented|initial|declared).*profile|unsupported (?:operation|method)|is not (?:yet )?implemented/i,
    dependsOn: ['adapter-provenance'], reference: 'docs/support.json' },
  { id: 'compiler-program', priority: 3, title: 'Shader translation and program finalization',
    pattern: /WGSL|shader.*(?:compil|translat)|compil.*shader|linkProgram|program.*link|unsupported.*(?:sampler|varying)|sampler.*unsupported/i,
    dependsOn: ['context-initialization'], reference: 'docs/architecture.md' },
  { id: 'context-configuration', priority: 4, title: 'Context attributes, capabilities and extensions',
    pattern: /context.?attributes|antialias|preserveDrawingBuffer|premultipliedAlpha|MAX_[A-Z_]+|getExtension|extension.*(?:missing|support)|getSupportedExtensions/i,
    dependsOn: ['context-initialization'], reference: 'docs/support.json' },
  { id: 'texture-images', priority: 5, title: 'Texture images, formats, sources and mipmaps',
    pattern: /texImage|texSubImage|copyTex|generateMipmap|mipmap|cube.?map|texture.*(?:format|size|complet|sampl)|UNPACK_|ImageBitmap|ImageData|HTMLImage|video/i,
    dependsOn: ['compiler-program'], reference: 'docs/spec-map.md' },
  { id: 'framebuffer-attachments', priority: 6, title: 'Framebuffer storage and attachment relationships',
    pattern: /framebuffer|renderbuffer|attachment|\bFBO\b|readPixels|readback/i,
    dependsOn: ['texture-images'], reference: 'docs/spec-map.md' },
  { id: 'vertex-draw', priority: 7, title: 'Vertex inputs, buffers and drawing modes',
    pattern: /vertexAttrib|drawArrays|drawElements|bufferData|bufferSubData|index buffer|vertex buffer|non-triangle|primitive mode/i,
    dependsOn: ['compiler-program'], reference: 'docs/spec-map.md' },
  { id: 'program-uniforms', priority: 7, title: 'Program state, uniform values and object lifetime',
    pattern: /uniform|program.*(?:delet|relink|validat)|shader.*delet|object.*(?:delet|lifetime|identity)/i,
    dependsOn: ['compiler-program'], reference: 'docs/spec-map.md' },
  { id: 'raster-state', priority: 8, title: 'Raster, depth, stencil and blend state',
    pattern: /blend|stencil|scissor|depthFunc|depthMask|depthRange|polygonOffset|cullFace|frontFace|colorMask|raster/i,
    dependsOn: ['vertex-draw', 'framebuffer-attachments'], reference: 'docs/spec-map.md' },
  { id: 'gl-validation', priority: 9, title: 'GL enum, value and operation validation',
    pattern: /INVALID_ENUM|INVALID_VALUE|INVALID_OPERATION|INVALID_FRAMEBUFFER_OPERATION|OUT_OF_MEMORY|TypeError|wrong.*(?:enum|type)|getError/i,
    dependsOn: ['context-configuration'], reference: 'docs/spec-map.md' },
];

function statusCounts() {
  return Object.fromEntries([...STATUSES, 'missing', 'invalid'].map(status => [status, 0]));
}

function assertions() {
  return { passed: 0, failed: 0, skipped: 0, assertionTimeouts: 0, skippedFailures: 0,
    effectiveFailed: 0, totalAssertions: 0, retainedFailureMessages: 0, truncatedFailureMessages: 0 };
}

function caseAssertions(result) {
  const counts = Object.fromEntries(['passed', 'failed', 'skipped', 'assertionTimeouts', 'skippedFailures']
    .map(key => [key, validCount(result[key]) ? result[key] : 0]));
  return { ...counts, effectiveFailed: Math.max(0, counts.failed - counts.skippedFailures),
    totalAssertions: counts.passed + counts.failed + counts.assertionTimeouts };
}

function addAssertions(total, result) {
  for (const [key, value] of Object.entries(caseAssertions(result))) total[key] += value;
  total.retainedFailureMessages += Array.isArray(result.failures) ? result.failures.length : 0;
  total.truncatedFailureMessages += validCount(result.failuresTruncated) ? result.failuresTruncated : 0;
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function relativeUrl(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('/')
    && !value.includes('\\') && !value.split('/').includes('..') && !/^[a-z]+:/i.test(value);
}

function moduleName(url) {
  const segments = url.split('/');
  return segments[0] === 'conformance' ? `conformance/${segments[1] ?? '(root)'}` : segments[0];
}

function resultProblems(result, backend) {
  const problems = [];
  if (!validCount(result.index)) problems.push('index must be a nonnegative integer');
  if (!relativeUrl(result.url)) problems.push('url must be relative to sdk/tests');
  if (result.backend !== backend) problems.push('backend does not match its result file');
  if (!STATUSES.includes(result.status)) problems.push('unknown status');
  if (!['finished', 'timeout', 'crash', 'capability-error'].includes(result.completion)) problems.push('unknown completion');
  for (const field of ['passed', 'failed', 'skipped', 'failuresTruncated']) {
    if (!validCount(result[field])) problems.push(`${field} must be a nonnegative integer`);
  }
  for (const field of ['assertionTimeouts', 'skippedFailures']) {
    if (result[field] !== undefined && !validCount(result[field])) problems.push(`${field} must be a nonnegative integer`);
  }
  if ((result.skippedFailures ?? 0) > result.failed || (result.skippedFailures ?? 0) > result.skipped) {
    problems.push('skippedFailures exceed failed or skipped assertions');
  }
  if (!Number.isFinite(result.durationMs) || result.durationMs < 0) problems.push('durationMs must be nonnegative');
  if (!Array.isArray(result.failures) || result.failures.some(value => typeof value !== 'string')) {
    problems.push('failures must contain original message strings');
  } else if (result.failures.length > FAILURE_LIMIT) problems.push('failures exceed the 200-message limit');
  if (Array.isArray(result.failures) && validCount(result.failed) && validCount(result.failuresTruncated)
    && result.failures.length + result.failuresTruncated > result.failed) {
    problems.push('retained and truncated failure messages exceed raw failed assertions');
  }
  for (const field of ['errors', 'contexts', 'adapterGaps']) {
    if (!Array.isArray(result[field]) || result[field].some(value => !value || typeof value !== 'object' || Array.isArray(value))) {
      problems.push(`${field} must contain records`);
    }
  }
  if (result.status === 'pass' && (result.failed > (result.skippedFailures ?? 0)
    || (result.assertionTimeouts ?? 0) > 0 || result.completion !== 'finished')) {
    problems.push('pass contradicts failed assertions or incomplete execution');
  }
  if (result.status === 'timeout' && !['timeout', 'crash'].includes(result.completion)
    && !(result.completion === 'finished' && result.assertionTimeouts > 0)) problems.push('timeout contradicts completion');
  return problems;
}

function evidence(result) {
  return [
    ...(Array.isArray(result.failures) ? result.failures.filter(message => typeof message === 'string')
      .slice(0, FAILURE_LIMIT).map(message => ({ source: 'failure', message })) : []),
    ...(Array.isArray(result.errors) ? result.errors.filter(error => error && typeof error === 'object')
      .map(error => ({ source: 'error', kind: error.kind, name: error.name,
        message: error.message ?? '', url: error.url })) : []),
  ];
}

function safeRecords(value) {
  return Array.isArray(value) ? value.filter(record => record && typeof record === 'object') : [];
}

function annotate(result, backend, problems, duplicate) {
  const annotations = [];
  const contexts = safeRecords(result.contexts);
  const mismatches = contexts.filter(context => context.actualCore !== backend
    || (context.requestedCore !== undefined && context.requestedCore !== backend));
  const gaps = safeRecords(result.adapterGaps);
  if (problems.length) annotations.push({ kind: 'invalid-result', messages: problems });
  if (duplicate) annotations.push({ kind: 'duplicate-result' });
  if (mismatches.length) annotations.push({ kind: 'core-provenance-mismatch', contexts: mismatches });
  if (gaps.length) annotations.push({ kind: 'adapter-gap', gaps });
  let effectiveStatus = STATUSES.includes(result.status) ? result.status : 'harness-error';
  if (problems.length || duplicate) effectiveStatus = 'harness-error';
  else if (effectiveStatus === 'pass' && mismatches.length) effectiveStatus = 'harness-error';
  else if (effectiveStatus === 'pass' && gaps.length) effectiveStatus = 'unsupported';
  return { annotations, effectiveStatus,
    provenance: contexts.length === 0 ? 'no-gl-context' : mismatches.length ? 'mismatch' : 'matched' };
}

export function buildConformanceReport(runs, { expectedInventoryCount = 971 } = {}) {
  if (!validCount(expectedInventoryCount) || expectedInventoryCount === 0) throw new Error('Invalid expected inventory count.');
  const candidates = BACKENDS.map(backend => runs[backend]?.inventory).filter(Array.isArray);
  if (!candidates.length) throw new Error('No official inventory is available in the backend result files.');
  const inventories = candidates.map(inventory => [...new Set(inventory.filter(relativeUrl))]);
  const inventory = inventories.find(urls => urls.length === expectedInventoryCount)
    ?? inventories.reduce((longest, urls) => urls.length > longest.length ? urls : longest, []);
  const inputIssues = [];
  const issue = (backend, kind, details) => inputIssues.push({ backend, kind, ...details });
  if (inventory.length !== expectedInventoryCount) {
    issue(null, 'inventory-count', { expected: expectedInventoryCount, actual: inventory.length,
      unidentifiedMissingFiles: Math.max(0, expectedInventoryCount - inventory.length) });
  }
  const files = [];
  const backends = {};
  const modules = new Map();
  for (const backend of BACKENDS) {
    const run = runs[backend];
    const sourceInventory = Array.isArray(run?.inventory) ? run.inventory : [];
    const sourceResults = Array.isArray(run?.results) ? run.results : [];
    if (!run) issue(backend, 'missing-backend', {});
    else {
      if (!Array.isArray(run.inventory)) issue(backend, 'invalid-inventory', {});
      if (!Array.isArray(run.results)) issue(backend, 'invalid-results', {});
      if (sourceInventory.some(url => !relativeUrl(url))) issue(backend, 'invalid-inventory-url', {});
      if (new Set(sourceInventory).size !== sourceInventory.length) issue(backend, 'duplicate-inventory', {});
      if (JSON.stringify(sourceInventory) !== JSON.stringify(inventory)) issue(backend, 'inventory-mismatch', {});
    }
    const records = new Map();
    for (const [recordIndex, result] of sourceResults.entries()) {
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        issue(backend, 'invalid-result', { recordIndex });
        continue;
      }
      if (!inventory.includes(result.url)) {
        issue(backend, 'unknown-result-url', { recordIndex, url: result.url });
        continue;
      }
      const values = records.get(result.url) ?? [];
      values.push(result);
      records.set(result.url, values);
    }
    const unidentifiedInventoryFiles = Math.max(0, expectedInventoryCount - inventory.length);
    const summary = { expectedFiles: expectedInventoryCount, inventoryFiles: inventory.length,
      reportedRecords: sourceResults.length, uniqueReportedFiles: records.size, missingFiles: 0,
      duplicateRecords: 0, originalFileStatuses: statusCounts(), effectiveFileStatuses: statusCounts(),
      assertions: assertions(), durationMs: 0, noGlContextFiles: 0, provenanceMismatchFiles: 0,
      adapterGapFiles: 0, partialAssertionCountFiles: 0, lateDiagnosticFiles: 0, capabilityTerminatedFiles: 0, timeoutsWithProfileDiagnostics: 0, environment: run?.environment ?? null };
    summary.unidentifiedInventoryFiles = unidentifiedInventoryFiles;
    summary.missingFiles = unidentifiedInventoryFiles;
    summary.originalFileStatuses.missing = unidentifiedInventoryFiles;
    summary.effectiveFileStatuses.missing = unidentifiedInventoryFiles;
    backends[backend] = summary;
    for (const [index, url] of inventory.entries()) {
      const matches = records.get(url) ?? [];
      const result = matches[0];
      const module = moduleName(url);
      const moduleKey = `${backend}/${module}`;
      if (!modules.has(moduleKey)) modules.set(moduleKey, { backend, module, inventoryFiles: 0,
        originalFileStatuses: statusCounts(), effectiveFileStatuses: statusCounts(), assertions: assertions() });
      const group = modules.get(moduleKey);
      group.inventoryFiles++;
      if (!result) {
        summary.missingFiles++;
        issue(backend, 'missing-result', { index, url });
        files.push({ index, url, backend, module, originalStatus: 'missing', effectiveStatus: 'missing',
          assertions: caseAssertions({}), annotations: [{ kind: 'missing-result' }] });
        summary.originalFileStatuses.missing++;
        summary.effectiveFileStatuses.missing++;
        group.originalFileStatuses.missing++;
        group.effectiveFileStatuses.missing++;
        continue;
      }
      const problems = resultProblems(result, backend);
      if (result.index !== index) problems.push('index does not match its official inventory URL');
      if (problems.length) issue(backend, 'invalid-result', { index, url, messages: problems });
      if (matches.length > 1) {
        summary.duplicateRecords += matches.length - 1;
        issue(backend, 'duplicate-result', { index, url, records: matches.length });
      }
      const annotation = annotate(result, backend, problems, matches.length > 1);
      const originalStatus = STATUSES.includes(result.status) ? result.status : 'invalid';
      const file = { index, reportedIndex: result.index, url, backend, module, originalStatus: result.status,
        ...annotation, completion: result.completion, assertionCountsComplete: !result.partialCountsUnavailable,
        observedCountersComplete: !result.partialCountsUnavailable, originalTestCompleted: result.completion === 'finished',
        capabilityTerminated: result.capabilityTerminated === true,
        ...(result.screenshot ? { screenshot: result.screenshot } : {}),
        lateDiagnostics: result.lateDiagnostics ?? [],
        assertions: caseAssertions(result),
        retainedFailureMessages: Array.isArray(result.failures) ? result.failures.length : 0,
        failuresTruncated: result.failuresTruncated, durationMs: result.durationMs, evidence: evidence(result) };
      files.push(file);
      summary.originalFileStatuses[originalStatus]++;
      summary.effectiveFileStatuses[annotation.effectiveStatus]++;
      group.originalFileStatuses[originalStatus]++;
      group.effectiveFileStatuses[annotation.effectiveStatus]++;
      addAssertions(summary.assertions, result);
      addAssertions(group.assertions, result);
      if (Number.isFinite(result.durationMs) && result.durationMs >= 0) summary.durationMs += result.durationMs;
      if (result.capabilityTerminated) summary.capabilityTerminatedFiles++;
      if (annotation.effectiveStatus === 'timeout' && (result.adapterGaps?.length
        || result.errors?.some(error => error.name === 'NotSupportedError'))) summary.timeoutsWithProfileDiagnostics++;
      if (result.lateDiagnostics?.length) summary.lateDiagnosticFiles++;
      if (result.partialCountsUnavailable) summary.partialAssertionCountFiles++;
      if (annotation.provenance === 'no-gl-context') summary.noGlContextFiles++;
      if (annotation.provenance === 'mismatch') summary.provenanceMismatchFiles++;
      if (annotation.annotations.some(item => item.kind === 'adapter-gap')) summary.adapterGapFiles++;
    }
  }
  const paired = new Map(inventory.map(url => [url, {}]));
  for (const file of files) paired.get(file.url)[file.backend] = {
    originalStatus: file.originalStatus, effectiveStatus: file.effectiveStatus,
    failedAssertions: file.assertions.failed, effectiveFailedAssertions: file.assertions.effectiveFailed,
  };
  for (const file of files) file.paired = paired.get(file.url);
  const clusters = buildClusters(files);
  return {
    summary: { schemaVersion: 1, expectedInventoryCount, officialInventoryFiles: inventory.length,
      expectedBackendFileExecutions: expectedInventoryCount * BACKENDS.length,
      complete: inputIssues.length === 0,
      assertionAggregation: 'Each official URL contributes its first record once. Duplicate records invalidate that file and remain in inputIssues.',
      assertionCounterSemantics: 'Raw skipped assertions overlap original counters. totalAssertions = passed + failed + assertionTimeouts. effectiveFailed = failed - skippedFailures.',
      inventory, backends,
      modules: [...modules.values()], inputIssues, files },
    clusters: { schemaVersion: 1, method: 'Evidence-pattern dependency candidates requiring specification and runtime review.',
      countsOverlap: true, uniqueHtmlFiles: inventory.length, rules: DEPENDENCY_RULES.map(({ pattern, ...rule }) =>
        ({ ...rule, evidencePattern: pattern.source, flags: pattern.flags })), clusters },
  };
}

function buildClusters(files) {
  const clusters = new Map();
  const add = (id, title, priority, file, matchedEvidence = []) => {
    if (!clusters.has(id)) clusters.set(id, { id, title, priority, backendFileExecutions: 0,
      backends: Object.fromEntries(BACKENDS.map(backend => [backend, 0])), files: [] });
    const cluster = clusters.get(id);
    cluster.backendFileExecutions++;
    cluster.backends[file.backend]++;
    cluster.files.push({ backend: file.backend, index: file.index, url: file.url,
      originalStatus: file.originalStatus, effectiveStatus: file.effectiveStatus,
      assertions: file.assertions, failuresTruncated: file.failuresTruncated ?? 0,
      paired: file.paired, matchedEvidence: matchedEvidence.slice(0, 5) });
  };
  for (const file of files) {
    if (file.effectiveStatus === 'pass' || file.effectiveStatus === 'skip') continue;
    if (file.effectiveStatus === 'missing') {
      add('missing-results', 'Unexecuted or missing result records', 0, file);
      continue;
    }
    if (file.annotations.some(item => ['invalid-result', 'duplicate-result'].includes(item.kind))) {
      add('result-integrity', 'Invalid or ambiguous result records', 0, file);
    }
    if (file.annotations.some(item => ['core-provenance-mismatch', 'adapter-gap'].includes(item.kind))) {
      add('adapter-provenance', 'Context provenance and adapter coverage', 0, file,
        file.annotations.map(item => ({ source: 'annotation', message: JSON.stringify(item) })));
    }
    if (file.backend === 'native') add('native-observation', 'Native failures requiring paired investigation', 10, file, file.evidence);
    if (file.effectiveStatus === 'timeout' || file.effectiveStatus === 'harness-error') {
      add('execution-reliability', 'Timeouts and harness execution errors', 1, file, file.evidence);
    }
    let matched = false;
    for (const rule of DEPENDENCY_RULES) {
      const matches = file.evidence.filter(item => rule.pattern.test(`${item.name ?? ''} ${item.kind ?? ''} ${item.message}`));
      if (matches.length) { add(rule.id, rule.title, rule.priority, file, matches); matched = true; }
    }
    if (!matched && file.effectiveStatus !== 'harness-error' && file.effectiveStatus !== 'timeout') {
      add('unclassified', 'Failures requiring additional retained evidence or specification audit', 11, file, file.evidence);
    }
  }
  return [...clusters.values()].map(cluster => ({ ...cluster,
    uniqueHtmlFiles: new Set(cluster.files.map(file => file.url)).size,
    failedAssertions: cluster.files.reduce((sum, file) => sum + (validCount(file.assertions.failed) ? file.assertions.failed : 0), 0),
    effectiveFailedAssertions: cluster.files.reduce((sum, file) => sum + file.assertions.effectiveFailed, 0),
    exampleUrls: [...new Set(cluster.files.map(file => file.url))].slice(0, 5),
  })).sort((first, second) => first.priority - second.priority
    || second.backendFileExecutions - first.backendFileExecutions || first.id.localeCompare(second.id));
}

function markdown({ summary, clusters }) {
  const lines = ['# Official WebGL1 conformance baseline', '',
    `Official inventory contains ${summary.officialInventoryFiles} unique HTML files against ${summary.expectedInventoryCount} expected.`,
    `Result collection is ${summary.complete ? 'complete' : 'incomplete'} with ${summary.inputIssues.length} input issues.`, '',
    '| Backend | Expected files | Reported unique files | Effective pass | Fail | Unsupported | Timeout | Harness error | Skip | Missing | Total assertions | Raw failed assertions | Effective failed assertions |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const backend of BACKENDS) {
    const row = summary.backends[backend];
    const counts = row.effectiveFileStatuses;
    lines.push(`| ${backend} | ${row.expectedFiles} | ${row.uniqueReportedFiles} | ${counts.pass} | ${counts.fail} | ${counts.unsupported} | ${counts.timeout} | ${counts['harness-error']} | ${counts.skip} | ${counts.missing} | ${row.assertions.totalAssertions} | ${row.assertions.failed} | ${row.assertions.effectiveFailed} |`);
  }
  lines.push('', 'Original statuses, skip counts, context provenance and per-module totals remain in summary.json.',
    'An uncaught NotSupportedError may end a selected-core file at a capability barrier. Observed counters remain exact, and unexecuted assertions are marked by originalTestCompleted/capabilityTerminated.',
    'Cases terminated after an unresponsive browser can have unavailable partial assertion counts. These files are counted in partialAssertionCountFiles.',
    'Total assertions equal passed + failed + assertionTimeouts. Skipped assertions overlap these counters. Effective failed assertions exclude skippedFailures.',
    'Clusters overlap and group retained evidence into dependency candidates. Native failures require paired investigation.',
    '', '## Module pass counts', '',
    '| Module | Inventory files | Native | JS | Rust |',
    '| --- | ---: | ---: | ---: | ---: |');
  const moduleRows = new Map(summary.modules.map(row => [`${row.backend}/${row.module}`, row]));
  for (const row of summary.modules.filter(row => row.backend === 'native').sort((a, b) => a.module.localeCompare(b.module))) {
    const counts = BACKENDS.map(backend => moduleRows.get(`${backend}/${row.module}`).effectiveFileStatuses.pass);
    lines.push(`| ${row.module} | ${row.inventoryFiles} | ${counts.join(' | ')} |`);
  }
  lines.push('', '## Dependency candidates', '');
  for (const cluster of clusters.clusters) {
    lines.push(`- ${cluster.title} affects ${cluster.uniqueHtmlFiles} unique HTML files across ${cluster.backendFileExecutions} backend-file executions. Examples include ${cluster.exampleUrls.map(url => `\`${url}\``).join(', ')}.`);
  }
  return `${lines.join('\n')}\n`;
}

export async function writeConformanceReport({ inputDirectory = DEFAULT_DIRECTORY, outputDirectory = inputDirectory } = {}) {
  const runs = {};
  for (const backend of BACKENDS) {
    try { runs[backend] = JSON.parse(await readFile(join(inputDirectory, backend, 'results.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const report = buildConformanceReport(runs);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, 'summary.json'), `${JSON.stringify(report.summary, null, 2)}\n`);
  await writeFile(join(outputDirectory, 'failure-clusters.json'), `${JSON.stringify(report.clusters, null, 2)}\n`);
  await writeFile(join(outputDirectory, 'summary.md'), markdown(report));
  return report;
}

async function main() {
  const options = {};
  for (let index = 2; index < process.argv.length; index++) {
    const argument = process.argv[index];
    if (argument === '--help') {
      console.log('node tools/conformance-report.mjs [--input directory] [--output directory]');
      return;
    }
    if (!['--input', '--output'].includes(argument) || !process.argv[index + 1]
      || process.argv[index + 1].startsWith('--')) {
      throw new Error(`Invalid report argument ${argument}`);
    }
    options[argument === '--input' ? 'inputDirectory' : 'outputDirectory'] = process.argv[++index];
  }
  const report = await writeConformanceReport(options);
  console.log(`Reported ${report.summary.officialInventoryFiles} official HTML files for ${BACKENDS.join(', ')}. Collection ${report.summary.complete ? 'complete' : 'incomplete'}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

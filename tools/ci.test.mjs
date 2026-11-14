import assert from 'node:assert/strict';
import test from 'node:test';
import { selectChecks, validateMarkdown, validateMessage } from './ci.mjs';

test('documentation and support-only changes use metadata verification', () => {
  assert.deepEqual(selectChecks(['README.md', 'docs/roadmap.md', '.github/PULL_REQUEST_TEMPLATE.md']), { js: false, rust: false });
  assert.deepEqual(selectChecks(['docs/support.json']), { js: false, rust: false });
});

test('JS and native Rust changes select their own checks', () => {
  assert.deepEqual(selectChecks(['packages/webgl/src/index.ts']), { js: true, rust: false });
  assert.deepEqual(selectChecks(['crates/core/src/lib.rs', 'Cargo.lock']), { js: false, rust: true });
  assert.deepEqual(selectChecks(['rust-toolchain.toml']), { js: false, rust: true });
});

test('shared contracts, Wasm bindings and CI infrastructure verify both cores', () => {
  for (const path of ['packages/core-api/src/index.ts', 'packages/core-wasm/src/index.ts',
    'tools/rust.mjs', 'tools/ci.mjs', 'tools/ci.test.mjs', '.github/workflows/ci.yml']) {
    assert.deepEqual(selectChecks([path]), { js: true, rust: true }, path);
  }
});

test('unknown executable changes conservatively select JS checks', () => {
  assert.deepEqual(selectChecks(['tools/new-command.mjs', 'pnpm-lock.yaml']), { js: true, rust: false });
  assert.deepEqual(selectChecks([]), { js: false, rust: false });
});

test('commit and PR messages follow the existing lowercase convention', () => {
  for (const message of ['feat: add buffers', 'fix: preserve state\n\nretain previous storage.', 'refactor: simplify uploads']) {
    assert.doesNotThrow(() => validateMessage(message));
  }
  for (const message of ['docs: update roadmap', 'feat: Add buffers', 'fix: preserve state\n\nUppercase body.', 'feat: ', 'Merge branch main']) {
    assert.throws(() => validateMessage(message));
  }
});

test('Markdown validation handles local paths, anchors, and external URLs', () => {
  const seen = [];
  validateMarkdown('docs/README.md', '[guide](architecture.md#modules) [site](https://example.com) [anchor](#intro)', path => {
    seen.push(path);
    return true;
  });
  assert.equal(seen.length, 1);
  assert.ok(seen[0].endsWith('/docs/architecture.md'));
  assert.throws(() => validateMarkdown('docs/README.md', '[missing](missing.md)', () => false), /missing file/);
  assert.doesNotThrow(() => validateMarkdown('README.md', '[space](<docs/a%20file.md>)', () => true));
});

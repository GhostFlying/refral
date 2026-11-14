import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
}

export function selectChecks(paths) {
  const infrastructure = paths.some(path => path.startsWith('.github/workflows/') || /^tools\/ci[.]/.test(path));
  const documentation = path => path.endsWith('.md');
  const nativeRust = path => path.startsWith('crates/') || ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'].includes(path);
  return {
    js: infrastructure || paths.some(path => !documentation(path) && !nativeRust(path) && path !== 'docs/support.json'),
    rust: infrastructure || paths.some(path => !documentation(path) && (
      nativeRust(path) || path.startsWith('packages/core-api/') || path.startsWith('packages/core-wasm/') || path === 'tools/rust.mjs'
    )),
  };
}

export function validateMessage(message, label = 'Commit') {
  const subject = message.split('\n')[0];
  if (!/^(feat|fix|refactor): \S.*$/.test(subject) || message !== message.toLowerCase()) {
    throw new Error(`${label} must use a lowercase feat/fix/refactor message: ${subject}`);
  }
}

export function validateMarkdown(path, text, exists = existsSync) {
  for (const match of text.matchAll(/\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) continue;
    const local = decodeURIComponent(target.split('#')[0]);
    if (local && !exists(resolve(dirname(path), local))) {
      throw new Error(`${path} links to a missing file: ${target}`);
    }
  }
}

function eventRange() {
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const name = process.env.GITHUB_EVENT_NAME;
  let base;
  let head = 'HEAD';
  let pullRequest = false;
  if (name === 'pull_request') {
    base = event.pull_request?.base?.sha;
    head = event.pull_request?.head?.sha;
    pullRequest = true;
    if (!base || !head) throw new Error('Pull request event requires base and head revisions.');
  } else if (name === 'push') {
    base = /^0+$/.test(event.before ?? '') ? null : event.before;
    head = event.after;
  } else if (!name) {
    base = git('merge-base', 'origin/main', 'HEAD');
  }
  for (const sha of [base, head]) {
    if (sha && sha !== 'HEAD' && !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(sha)) {
      throw new Error('Invalid CI revision.');
    }
  }
  return { event, base, head, pullRequest };
}

function changedFiles(range) {
  const paths = range.base
    ? git('diff', '--name-only', '-z', range.pullRequest ? `${range.base}...${range.head}` : range.base, ...(range.pullRequest ? [] : [range.head]))
    : git('ls-files', '-z');
  const untracked = process.env.GITHUB_EVENT_NAME ? '' : git('ls-files', '--others', '--exclude-standard', '-z');
  return [...new Set([...paths.split('\0'), ...untracked.split('\0')].filter(Boolean))];
}

function verify() {
  const range = eventRange();
  if (range.pullRequest) validateMessage(range.event.pull_request.title, 'PR title');
  const revision = range.base ? `${range.base}..${range.head}` : range.head;
  const commits = git('rev-list', '--parents', revision).split('\n').filter(Boolean);
  for (const commit of commits) {
    const [sha, ...parents] = commit.split(' ');
    if (parents.length > 1) throw new Error(`PR history must be linear: ${sha}`);
    validateMessage(git('show', '-s', '--format=%B', sha), sha);
  }
  const paths = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0');
  let markdown = 0;
  for (const path of paths.filter(path => path.endsWith('.md') && existsSync(path))) {
    validateMarkdown(path, readFileSync(path, 'utf8'));
    markdown++;
  }
  console.log(`Validated ${commits.length} commit messages and ${markdown} Markdown files.`);
}

function scope() {
  const paths = changedFiles(eventRange());
  const checks = selectChecks(paths);
  const rust = readFileSync('rust-toolchain.toml', 'utf8').match(/^channel\s*=\s*"(\d+\.\d+\.\d+)"/m)?.[1];
  if (!rust) throw new Error('Expected a pinned Rust channel.');
  const outputs = `js=${checks.js}\nrust=${checks.rust}\nrust_version=${rust}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## Required verification\n\nRevision \`${git('rev-parse', 'HEAD')}\`\n\n`
      + `| Check | Selected |\n| --- | --- |\n| Documentation, policy, support | true |\n| JS types and CPU tests | ${checks.js} |\n| Native Rust tests | ${checks.rust} |\n\n`
      + `${paths.length} changed files.\n`);
  }
  console.log(outputs.trim());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'scope') scope();
    else if (process.argv[2] === 'verify') verify();
    else throw new Error('Use node tools/ci.mjs scope or verify.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

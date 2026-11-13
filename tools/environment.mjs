import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export async function findTool(name) {
  const extra = [path.dirname(process.execPath), path.join(homedir(), '.cargo/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  const directories = [...new Set([...(process.env.PATH ?? '').split(path.delimiter), ...extra])];
  for (const directory of directories) {
    const candidate = path.join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch { /* Continue to the next installed tool directory. */ }
  }
  return null;
}

export async function availableChrome() {
  for (const candidate of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* Try another supported install path. */ }
  }
  return findTool('google-chrome');
}

export function commandVersion(executable, args = ['--version'], env = process.env) {
  if (!executable) return null;
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 15_000, env });
  return result.status === 0 ? (result.stdout || result.stderr).trim().split('\n')[0] : null;
}

export async function hasDirectory(directory) {
  try { await readdir(directory); return true; } catch { return false; }
}

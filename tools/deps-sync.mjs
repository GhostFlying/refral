import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';

async function runIfPresent(file) {
  try { await access(file); } catch { throw new Error(`Dependency acquisition is still being implemented: ${file}`); }
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${file} exited ${code}`)));
  });
}

await runIfPresent('tools/deps-compiler.mjs');
await runIfPresent('tools/deps-fixtures.mjs');

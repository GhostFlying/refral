import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release } from 'node:os';
import type { Browser } from '@playwright/test';

export async function captureEnvironment(browser: Browser, directory: string) {
  await mkdir(directory, { recursive: true });
  execFileSync(process.execPath, ['tools/snapshot.mjs']);
  const sourceBytes = await readFile('artifacts/environment/source.json', 'utf8');
  await writeFile(`${directory}/source.json`, sourceBytes);
  const source = JSON.parse(sourceBytes);
  const session = await browser.newBrowserCDPSession();
  let commandLine: string;
  try {
    const processes = (await session.send('SystemInfo.getProcessInfo')).processInfo;
    const process = processes.find((value) => value.type === 'browser');
    if (!process) throw new Error('Chrome process metadata unavailable.');
    commandLine = execFileSync('ps', ['-ww', '-p', String(process.id), '-o', 'command='], { encoding: 'utf8' }).trim();
  } finally {
    await session.detach();
  }
  const hashes: Record<string, string> = {};
  for (const [name, path] of [
    ['rust', 'artifacts/core-wasm/refral_core.wasm'],
    ['compiler', 'artifacts/compiler/compiler.wasm'],
  ] as const) {
    hashes[name] = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  }
  return {
    browserVersion: browser.version(),
    launch: { channel: 'chrome', headless: process.env.REFRAL_HEADLESS !== '0', commandLine },
    machine: { platform: platform(), release: release(), architecture: arch(), cpu: cpus()[0]?.model },
    source: { head: source.head, treeSha256: source.treeSha256 },
    hashes,
  };
}

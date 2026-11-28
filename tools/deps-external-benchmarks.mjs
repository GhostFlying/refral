import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const sources = [
  ['samples', 'WebGLSamples/WebGLSamples.github.io', '6d56695888ec72b1ef2674498e307f1ab4310226',
    ['aquarium', 'dynamic-cubemap', 'fishtank/assets/lobby', 'tdl', 'khronos', 'shared', 'jquery-ui-1.8.2.custom', 'images', 'js', 'css']],
  ['animometer', 'kenrussell/webgl-animometer', '86355610e801bceb0b4f4da465c29699690b5b6f', ['Animometer']],
  ['unity', 'mozilla/arewefastyet', '0e2160885d0ca693577d54f1bbbe572f052282c6', ['benchmarks/unity-webgl']],
];

function acquire([name, repository, revision, directories]) {
  const cwd = resolve('artifacts/external-benchmarks/sources', name);
  mkdirSync(cwd, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  if (!existsSync(resolve(cwd, '.git'))) {
    git('init', '--quiet');
    git('remote', 'add', 'origin', 'https://github.com/' + repository + '.git');
  }
  git('sparse-checkout', 'set', '--cone', ...directories);
  if (git('rev-parse', '--disambiguate=' + revision) !== revision) {
    git('fetch', '--depth=1', '--filter=blob:none', 'origin', revision);
  }
  git('checkout', '--quiet', '--detach', revision);
  if (git('status', '--porcelain') || git('rev-parse', 'HEAD') !== revision)
    throw new Error('Unexpected benchmark checkout: ' + cwd);
  console.log(name, revision);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) sources.forEach(acquire);

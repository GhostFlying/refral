// Each invocation owns one Node isolate, one target and one backend.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { PNG } from 'pngjs';
import { createCompiler } from '../../packages/compiler/src/index.ts';
import { specializeUniformSweep, uniformSweep } from '../../tools/animometer-uniform-sweep.mjs';

const [backend, name, output] = process.argv.slice(2);
assert(['calibration', 'angle', 'rust'].includes(backend));
assert(name === 'animometer' || uniformSweep.has(name));
const root = resolve('artifacts/external-benchmarks/sources/animometer');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(revision, '86355610e801bceb0b4f4da465c29699690b5b6f');
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), '');
const base = join(root, 'Animometer/tests/3d');
const html = fs.readFileSync(join(base, 'webgl.html'), 'utf8');
const addon = process.env.REFRAL_COUNT_ALLOCATIONS === '1' ? 'animometer-audit' : 'animometer';
const native = createRequire(import.meta.url)(resolve('artifacts/native-dawn', addon + '.node'));
const compiler = await createCompiler(pathToFileURL(resolve('artifacts/compiler') + '/').href);
let program, buffer;
const streams = [],
  enabled = new Set();
const gl = {
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  ARRAY_BUFFER: 0x8892,
  STATIC_DRAW: 0x88e4,
  TRIANGLES: 4,
  FLOAT: 0x1406,
  COLOR_BUFFER_BIT: 0x4000,
  clearColor(...rgba) {
    assert.deepEqual(rgba, [0.5, 0.5, 0.5, 1]);
  },
  createShader(type) {
    return { stage: type === this.VERTEX_SHADER ? 'vertex' : 'fragment' };
  },
  shaderSource(shader, source) {
    shader.source = source;
  },
  compileShader(shader) {
    shader.result = compiler.compile(shader.source, shader.stage, 1);
  },
  getShaderParameter(shader, p) {
    assert.equal(p, this.COMPILE_STATUS);
    return shader.result.success;
  },
  getShaderInfoLog(shader) {
    return shader.result.log;
  },
  createProgram() {
    return {};
  },
  attachShader(p, s) {
    p[s.stage] = s;
  },
  linkProgram(p) {
    p.linked = compiler.link(p.vertex.result, p.fragment.result, {});
  },
  getProgramParameter(p, param) {
    assert.equal(param, this.LINK_STATUS);
    return p.linked.success;
  },
  getProgramInfoLog(p) {
    return p.linked.log;
  },
  useProgram(p) {
    program = p;
  },
  getUniformLocation(p, name) {
    const i = p.linked.uniforms.findIndex((u) => u.name === name);
    return i < 0 ? null : native.locationAt(i);
  },
  getAttribLocation(p, name) {
    return p.linked.attributes.find((a) => a.name === name)?.location ?? -1;
  },
  enableVertexAttribArray(i) {
    enabled.add(i);
  },
  createBuffer() {
    return {};
  },
  bindBuffer(target, b) {
    assert.equal(target, this.ARRAY_BUFFER);
    buffer = b;
  },
  bufferData(target, values, usage) {
    assert.equal(target, this.ARRAY_BUFFER);
    assert.equal(usage, this.STATIC_DRAW);
    buffer.data = Array.from(values);
  },
  vertexAttribPointer(i, ...format) {
    assert.deepEqual(format, [4, this.FLOAT, false, 0, 0]);
    streams[i] = buffer.data;
  },
  clear: native.clear,
  drawArrays: native.drawArrays,
  uniform1f: native.uniform1f,
  flush: native.flush,
};
const canvas = {
  getBoundingClientRect() {
    return { width: 800, height: 600 };
  },
  clientWidth: 800,
  clientHeight: 600,
  setAttribute(k, v) {
    this[k] = v;
  },
  getContext(kind) {
    assert.equal(kind, 'webgl');
    return gl;
  },
};
globalThis.window = globalThis;
globalThis.location = new URL('http://localhost/webgl.html');
globalThis.getComputedStyle = () =>
  new Proxy({ getPropertyValue: () => '0px' }, { get: (obj, k) => obj[k] ?? '0px' });
globalThis.document = {
  body: { offsetWidth: 800, offsetHeight: 600 },
  getElementById(id) {
    if (id === 'stage') return canvas;
    const match = html.match(new RegExp('<script id="' + id + '"[^>]*>([\\s\\S]*?)</script>'));
    assert(match, id);
    return { text: match[1] };
  },
};
let callback,
  tick = 0;
const frameTime = () => 100000 + tick * (1000 / 60);
const OriginalDate = Date;
globalThis.Date = class extends OriginalDate {
  constructor(...args) {
    super(...(args.length ? args : [frameTime()]));
  }
  static now() {
    return frameTime();
  }
};
let seed = 123456;
Math.random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
globalThis.requestAnimationFrame = (f) => {
  callback = f;
  return 1;
};
const execute = (script, file) => vm.runInThisContext(script, { filename: file });
for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
  let script = fs.readFileSync(resolve(base, src), 'utf8');
  if (src === 'resources/webgl.js' && uniformSweep.has(name))
    script = specializeUniformSweep(script, uniformSweep.get(name));
  execute(script, src);
}
const inline = html.match(/<script>\s*(var b = new WebGLStage;[\s\S]*?)<\/script>/)[1];
assert(inline.trimEnd().endsWith('cb();'));
execute(inline.slice(0, inline.lastIndexOf('cb();')), 'animometer-init.js');
assert.equal(enabled.size, 2);
native.start(
  backend,
  JSON.stringify({
    vs: program.vertex.source,
    fs: program.fragment.source,
    linked: program.linked,
    streams,
  }),
);
try {
  execute('cb();', 'animometer-bootstrap.js');
  gl.flush();
  native.finish();
  const warmup = Number(process.env.REFRAL_WARMUP ?? 30),
    samples = Number(process.env.REFRAL_SAMPLES ?? 120);
  const times = [],
    width = 800,
    height = 600;
  const drawCount = name === 'animometer-setup' ? 0 : 20000;
  const writes = name === 'animometer' ? 120000 : 6 + (uniformSweep.get(name) ?? 0) * drawCount;
  let before, after;
  for (let frame = 0; frame < warmup + samples; frame++) {
    if (frame === warmup) before = native.stats();
    tick++;
    const start = performance.now();
    callback(Date.now());
    gl.flush();
    const elapsed = performance.now() - start;
    if (frame >= warmup) times.push(elapsed);
    if (frame === warmup + samples - 1) after = native.stats();
    native.finish();
  }
  const counts = after.map((x, i) => x - before[i]);
  assert.equal(counts[0] + counts[1], samples * drawCount);
  assert.equal(counts[2] + counts[3], samples * writes);
  if (process.execArgv.includes('--no-turbo-fast-api-calls'))
    assert.equal(counts[0] + counts[2], 0);
  let expectedChecksum;
  if (backend === 'calibration') {
    expectedChecksum = native.pixels().readUInt32LE();
    const slots = new Map(Array.from({ length: 6 }, (_, i) => [native.locationAt(i), i]));
    const scalar = new Float32Array(1),
      bits = new Uint32Array(scalar.buffer);
    gl.uniform1f = (loc, x) => {
      scalar[0] = x;
      expectedChecksum = (expectedChecksum + slots.get(loc) + bits[0]) >>> 0;
      native.uniform1f(loc, x);
    };
    gl.drawArrays = (m, f, n) => {
      expectedChecksum = (expectedChecksum + m + f + n) >>> 0;
      native.drawArrays(m, f, n);
    };
  }
  tick++;
  callback(Date.now());
  gl.flush();
  native.finish();
  const image = native.pixels();
  const result = {
    backend,
    name,
    node: process.version,
    v8: process.versions.v8,
    execArgv: process.execArgv,
    revision,
    adapter: native.adapter(),
    warmup,
    samples,
    counts,
    times,
  };
  if (backend === 'calibration') {
    result.checksum = image.readUInt32LE();
    assert.equal(result.checksum, expectedChecksum);
  } else {
    assert.equal(image.length, width * height * 4);
    const png = new PNG({ width, height });
    png.data = image;
    fs.writeFileSync(output + '.png', PNG.sync.write(png));
  }
  fs.writeFileSync(output + '.json', JSON.stringify(result));
  console.log(name, backend, result.adapter, counts);
} finally {
  native.stop();
}

import assert from 'node:assert/strict';

export const uniformSweep = new Map([
  ['animometer-setup', null],
  ...[0, 1, 3, 6].map(count => [`animometer-uniforms-${count}`, count]),
]);

// Specialize the pinned upstream loop before serving it. Each variant has literal call sites.
export function specializeUniformSweep(source, updates) {
  const fields = ['Scale', 'Time', 'OffsetX', 'OffsetY', 'Scalar', 'ScalarOffset'];
  const start = source.indexOf('this._uniformData = new Float32Array(this._bufferSize * 6);');
  const end = source.indexOf('\n                }', start);
  const loop = source.lastIndexOf('for (var i = 0; i < this._numTriangles; ++i) {');
  const loopEnd = source.indexOf('\n                }', loop);
  assert(start >= 0 && end > start && loop > end && loopEnd > loop);
  assert(source.slice(loop, loopEnd).includes('gl.drawArrays(gl.TRIANGLES, 0, 3);'));
  const write = (field, i, offset) => `gl.uniform1f(this._u${field}, this._uniformData[${offset}${i}]);`;
  const initialize = fields.map((field, i) => write(field, i, '')).join('\n');
  const draws = updates === null ? '' : `for (var i = 0; i < this._numTriangles; ++i) {
    ${fields.slice(0, updates).map((field, j) => write(field, j, 'i * 6 + ')).join('\n')}
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }`;
  const prepare = `this._uniformData = new Float32Array(this._bufferSize * 6);
    const bits = new Uint32Array(this._uniformData.buffer);
    for (let i = 0; i < this._bufferSize; ++i) {
      this._uniformData.set([0.125, 0.25, 0.125, 0.125, 1.0, 0.25], i * 6);
      for (let j = 0; j < 6; ++j) bits[i * 6 + j] += i % 2;
    }`;
  const close = '\n                }'.length;
  return source.slice(0, start) + prepare + source.slice(end + close, loop)
    + initialize + '\n' + draws + source.slice(loopEnd + close);
}

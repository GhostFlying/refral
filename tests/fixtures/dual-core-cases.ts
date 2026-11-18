import type { TestingHooks } from '@refral/webgl';
import { programCaseNames } from './case-names';

export const dualCoreCaseNames = [
  'float-uniform-setters', 'indexed-update-u8', 'indexed-update-u16', 'upload-view-snapshot',
  'attribute-layout-and-constants', 'matrix-attribute-columns', 'buffer-reallocation-and-delete', 'resize-attribute-size',
  'automatic-submit-and-flush', 'viewport-clear-regions', 'draw-validation-state',
  'triangle-strip-modes', 'line-and-fan-modes', 'polygon-offset-and-samples', 'point-sprites', 'integer-vertex-attributes', 'enabled-array-validation', 'location-name-validation',
  'retained-deletion-and-retirement', ...programCaseNames,
] as const;
export type DrawingCaseName = typeof dualCoreCaseNames[number];
export type DrawingBackend = 'native' | 'js' | 'rust';
export interface DrawingCheck { name: string; actual: unknown; expected: unknown; passed: boolean }
export interface PixelRegion { x: number; y: number; width: number; height: number; color: readonly number[] }
export interface DrawingResult {
  name: DrawingCaseName;
  backend: DrawingBackend;
  selectedCore: DrawingBackend | null;
  checks: DrawingCheck[];
  observations: Record<string, unknown>;
  failure: { name: string; message: string } | null;
  cleanupErrors: string[];
  width: number;
  height: number;
  pixels: number[];
  regions: PixelRegion[];
  shaders: Record<string, string>;
  environment: Record<string, unknown>;
  configuration: Record<string, unknown>;
  stats: Record<string, number> | null;
  validationErrors: string[];
}

const vertex = 'attribute vec4 a_position; void main() { gl_Position = a_position; }';
const fragment = 'precision mediump float; uniform vec4 u_color; void main() { gl_FragColor = u_color; }';
const mismatchedFragment = 'precision mediump float; varying vec4 v_missing; void main() { gl_FragColor = v_missing; }';
const invalidFragment = 'precision mediump float; void main() { gl_FragColor = missing; }';
const uniformsFragment = `precision mediump float;
uniform float u_r; uniform vec2 u_gb; uniform vec3 u_rgb; uniform vec4 u_rgba;
void main() { gl_FragColor = vec4(u_r + u_gb.x + u_rgb.x + u_rgba.x,
  u_gb.y + u_rgb.y + u_rgba.y, u_rgb.z + u_rgba.z, 1.0); }`;
const colorsVertex = `attribute vec2 a_position; attribute vec4 a_color; varying vec4 v_color;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_color = a_color; }`;
const colorsFragment = 'precision mediump float; varying vec4 v_color; void main() { gl_FragColor = v_color; }';
const quad = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
const leftQuad = [-1, -1, 0, -1, -1, 1, -1, 1, 0, -1, 0, 1];
const rightQuad = [0, -1, 1, -1, 0, 1, 0, 1, 1, -1, 1, 1];
const red = [255, 0, 0, 255];
const green = [0, 255, 0, 255];
const blue = [0, 0, 255, 255];
const black = [0, 0, 0, 255];
const attributes: WebGLContextAttributes = {
  alpha: false, depth: true, stencil: false, antialias: false,
  premultipliedAlpha: false, preserveDrawingBuffer: true,
};

function regions(name: DrawingCaseName): PixelRegion[] {
  const band = (x: number, width: number, color: readonly number[], height = 64): PixelRegion =>
    ({ x, y: 0, width, height, color });
  switch (name) {
    case 'float-uniform-setters':
      return [red, [128, 0, 0, 255], green, red, blue, green, [255, 255, 0, 255], [0, 255, 255, 255]]
        .map((color, index) => band(index * 8, 8, color));
    case 'indexed-update-u8':
    case 'indexed-update-u16':
    case 'buffer-reallocation-and-delete':
    case 'retained-deletion-and-retirement':
      return [band(0, 32, red), band(32, 32, green)];
    case 'attribute-layout-and-constants':
    case 'matrix-attribute-columns':
      return [band(0, 32, [255, 0, 255, 255]), band(32, 32, [0, 255, 255, 255])];
    case 'automatic-submit-and-flush':
      return [band(0, 16, red), band(16, 16, green), band(32, 32, blue)];
    case 'viewport-clear-regions':
      return [{ x: 0, y: 0, width: 32, height: 32, color: red },
        { x: 32, y: 0, width: 32, height: 32, color: blue },
        { x: 0, y: 32, width: 32, height: 32, color: blue },
        { x: 32, y: 32, width: 32, height: 32, color: green }];
    case 'resize-attribute-size': return [band(0, 96, blue, 32)];
    case 'draw-validation-state': return [band(0, 64, [255, 255, 0, 255])];
    case 'point-sprites': {
      const rectangles = [band(0, 64, black)];
      for (const [cx, cy] of [[16, 16], [48, 16], [32, 48]] as const) {
        for (const [dx, dy, color] of [[-8, -8, blue], [0, -8, [255, 255, 0, 255]],
          [-8, 0, red], [0, 0, green]] as const) {
          rectangles.push({ x: cx + dx, y: cy + dy, width: 8, height: 8, color });
        }
      }
      return rectangles;
    }
    case 'polygon-offset-and-samples': return [band(0, 64, green)];
    case 'line-and-fan-modes':
      return [band(0, 64, black), band(0, 16, red), band(16, 16, green),
        ...[8, 16, 24].map(y => ({ x: 32, y, width: 32, height: 1, color: blue }))];
    case 'triangle-strip-modes':
      return [red, green, blue, [255, 255, 0, 255]].map((color, index) => band(index * 16, 16, color));
    case 'integer-vertex-attributes':
      return [red, [127, 0, 0, 255], red, green].map((color, index) => band(index * 16, 16, color));
    case 'location-name-validation':
    case 'enabled-array-validation': return [band(0, 64, green)];
    case 'failed-current-program-relink': return [band(0, 64, [255, 127, 0, 255])];
    case 'successful-relink-reset':
      return [band(0, 16, red), band(16, 16, black), band(32, 32, green)];
    case 'shader-source-compile-executable':
      return [band(0, 16, red), band(16, 16, green), band(32, 16, blue), band(48, 16, [255, 255, 255, 255])];
    case 'detached-deleted-shader-executable': return [band(0, 32, red), band(32, 32, blue)];
    case 'shader-source-code-units': return [band(0, 64, black)];
    case 'upload-view-snapshot': return [band(0, 64, blue)];
  }
}

function makeProgram(gl: WebGLRenderingContext, sources: Record<string, string>) {
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, sources.vertex!], [gl.FRAGMENT_SHADER, sources.fragment!]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Shader compilation failed: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader);
  }
  gl.bindAttribLocation(program, 0, 'a_position');
  gl.bindAttribLocation(program, 1, 'a_color');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
  gl.useProgram(program);
  return program;
}

async function execute(name: DrawingCaseName, gl: WebGLRenderingContext, canvas: HTMLCanvasElement,
  hooks: TestingHooks | null, result: DrawingResult) {
  const check = (name: string, actual: unknown, expected: unknown) => {
    result.checks.push({ name, actual, expected, passed: JSON.stringify(actual) === JSON.stringify(expected) });
  };
  const expectError = (name: string, operation: () => void, error: number) => {
    operation();
    check(name, gl.getError(), error);
  };
  gl.viewport(0, 0, 64, 64);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const program = makeProgram(gl, result.shaders);
  check('current program wrapper identity', gl.getParameter(gl.CURRENT_PROGRAM) === program, true);
  const position = gl.getAttribLocation(program, 'a_position');
  check('bound position location', position, 0);
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(quad), gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  let color = gl.getUniformLocation(program, 'u_color');
  const draw = (r: number, g: number, b: number) => {
    gl.uniform4f(color, r, g, b, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  const fragmentShader = () => gl.getAttachedShaders(program)!.find(shader =>
    gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER)!;

  switch (name) {
    case 'location-name-validation': {
      const unlinked = gl.createProgram()!;
      const deleted = gl.createProgram()!;
      gl.deleteProgram(deleted);
      const precedence = (label: string, actual: number, expected: number) => {
        if (hooks) check(label, actual, expected);
        else result.observations[label] = actual;
      };
      const missing = (target: WebGLProgram, identifier: string, error: number,
        observeError: (label: string, actual: number, expected: number) => void = check) => {
        const state = target === unlinked ? 'unlinked' : target === deleted ? 'deleted' : 'linked';
        const label = state + ' ' + JSON.stringify(identifier);
        check('attribute ' + label, gl.getAttribLocation(target, identifier), -1);
        observeError('attribute error ' + label, gl.getError(), error);
        check('uniform ' + label, gl.getUniformLocation(target, identifier), null);
        observeError('uniform error ' + label, gl.getError(), error);
      };
      for (const identifier of ['a'.repeat(256), 'u[0]', 'u\nfield']) {
        missing(program, identifier, gl.NO_ERROR);
      }
      for (const identifier of ['a'.repeat(257), 'webgl_à', 'a"b', 'a@b', 'a\x7fb']) {
        missing(program, identifier, gl.INVALID_VALUE);
        gl.bindAttribLocation(program, 1, identifier);
        const observe = identifier.startsWith('webgl_') ? precedence : check;
        observe('invalid binding ' + identifier, gl.getError(), gl.INVALID_VALUE);
      }
      for (const identifier of ['gl_reserved', 'webgl_reserved', '_webgl_reserved']) {
        missing(program, identifier, gl.NO_ERROR);
        expectError('reserved binding ' + identifier, () => gl.bindAttribLocation(program, 1, identifier), gl.INVALID_OPERATION);
      }
      missing(unlinked, 'webgl_à', gl.INVALID_OPERATION, precedence);
      missing(deleted, 'webgl_à', gl.INVALID_VALUE);
      expectError('out-of-range attribute binding', () => gl.bindAttribLocation(program, 8_192, 'a_position'), gl.INVALID_VALUE);
      gl.linkProgram(program);
      check('retained position binding', gl.getAttribLocation(program, 'a_position'), position);
      color = gl.getUniformLocation(program, 'u_color');
      draw(0, 1, 0);
      gl.deleteProgram(unlinked);
      break;
    }
    case 'point-sprites': {
      const size = gl.getUniformLocation(program, 'u_size');
      gl.uniform1f(size, 16);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.FRONT_AND_BACK);
      gl.frontFace(gl.CW);
      const positions = new Float32Array(65536 * 4);
      positions.set([0, 0, -2, 1, -0.5, -0.5, 0, 1, 0, 0, 0, 1]);
      positions.set([0.5, -0.5, 0, 1], 65535 * 4);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
      gl.vertexAttribPointer(position, 4, gl.FLOAT, false, 0, 0);
      expectError('point first vertex', () => gl.drawArrays(gl.POINTS, 1, 1), gl.NO_ERROR);
      expectError('near-clipped point', () => gl.drawArrays(gl.POINTS, 0, 1), gl.NO_ERROR);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 65535]), gl.DYNAMIC_DRAW);
      expectError('indexed maximum point', () => gl.drawElements(gl.POINTS, 1, gl.UNSIGNED_SHORT, 2), gl.NO_ERROR);
      gl.viewport(16, 32, 32, 32);
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 2, Uint16Array.of(2));
      expectError('updated point index in a smaller viewport', () => gl.drawElements(gl.POINTS, 1, gl.UNSIGNED_SHORT, 2), gl.NO_ERROR);
      break;
    }
    case 'polygon-offset-and-samples': {
      gl.enable(gl.DEPTH_TEST);
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
      const plane = (tilt: number) => {
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
          -1, -1, -tilt, 1, -1, tilt, -1, 1, -tilt, 1, 1, tilt,
        ]), gl.STATIC_DRAW);
      };
      const paint = (green: boolean) => {
        gl.uniform4f(color, green ? 0 : 1, green ? 1 : 0, 0, 1);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      };
      // The second copy of the same plane is red when its bias must reject it.
      const cases = [
        { enabled: false, tilt: 0, factor: 2, units: 2, closer: false },
        { enabled: true, tilt: 0, factor: 0, units: 1.75, closer: false },
        { enabled: true, tilt: 0, factor: 0, units: -1.75, closer: true },
        { enabled: true, tilt: 0, factor: 0, units: 2 ** 34, closer: false },
        { enabled: true, tilt: 0, factor: 0, units: -(2 ** 34), closer: true },
        { enabled: true, tilt: -0.5, factor: 0.125, units: 0, closer: false },
        { enabled: true, tilt: 0.5, factor: -0.125, units: 0, closer: true },
      ];
      for (const [i, item] of cases.entries()) {
        gl.viewport(i * 8, 0, 8, 64);
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.depthFunc(gl.LEQUAL);
        plane(item.tilt);
        paint(item.enabled && !item.closer);
        gl.polygonOffset(item.factor, item.units);
        check(`stored factor ${i}`, gl.getParameter(gl.POLYGON_OFFSET_FACTOR), item.factor);
        check(`stored units ${i}`, gl.getParameter(gl.POLYGON_OFFSET_UNITS), item.units);
        if (item.enabled) gl.enable(gl.POLYGON_OFFSET_FILL);
        if (item.closer) gl.depthFunc(gl.LESS);
        paint(!item.enabled || item.closer);
      }
      gl.viewport(56, 0, 8, 64);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.SAMPLE_COVERAGE);
      gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.sampleCoverage(0, false);
      check('single-sample context', gl.getParameter(gl.SAMPLE_BUFFERS), 0);
      plane(0);
      gl.uniform4f(color, 0, 1, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      check('single-sample drawing error', gl.getError(), gl.NO_ERROR);
      break;
    }
    case 'line-and-fan-modes': {
      const vertices = (values: number[]) => gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
      vertices([0, 0, -1, -1, 1, -1, 1, 1, -1, 1]);
      gl.enable(gl.CULL_FACE);
      gl.viewport(0, 0, 16, 64);
      gl.uniform4f(color, 1, 0, 0, 1);
      expectError('array fan offset and winding', () => gl.drawArrays(gl.TRIANGLE_FAN, 1, 4), gl.NO_ERROR);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([99, 1, 2, 3, 4]), gl.STATIC_DRAW);
      gl.viewport(16, 0, 16, 64);
      gl.uniform4f(color, 0, 1, 0, 1);
      expectError('indexed fan offset and winding', () => gl.drawElements(gl.TRIANGLE_FAN, 4, gl.UNSIGNED_BYTE, 1), gl.NO_ERROR);
      gl.viewport(0, 0, 64, 64);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(32, 0, 32, 64);
      gl.cullFace(gl.FRONT_AND_BACK);
      gl.uniform4f(color, 0, 0, 1, 1);
      const row = (y: number) => (y + 0.5) / 32 - 1;
      vertices([0, 0, -2, row(8), 2, row(8), 0, 1]);
      expectError('line pair with trailing vertex', () => gl.drawArrays(gl.LINES, 1, 3), gl.NO_ERROR);
      vertices([-2, row(16), 0.5, row(16), 2, row(16)]);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([99, 0, 1, 2]), gl.STATIC_DRAW);
      expectError('indexed line strip', () => gl.drawElements(gl.LINE_STRIP, 3, gl.UNSIGNED_SHORT, 2), gl.NO_ERROR);
      vertices([-2, row(24), -2, 2, 2, 2, 2, row(24)]);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([99, 0, 1, 2, 3]), gl.STATIC_DRAW);
      expectError('loop closure under culling', () => gl.drawElements(gl.LINE_LOOP, 4, gl.UNSIGNED_BYTE, 1), gl.NO_ERROR);
      expectError('zero elements past storage', () => gl.drawElements(gl.LINE_LOOP, 0, gl.UNSIGNED_SHORT, 8), gl.NO_ERROR);
      expectError('nonempty elements past storage', () => gl.drawElements(gl.LINE_LOOP, 1, gl.UNSIGNED_SHORT, 8), gl.INVALID_OPERATION);
      break;
    }
    case 'triangle-strip-modes': {
      const positions = new Float32Array(65536 * 2);
      positions.set([-1, -1, 1, -1, -1, 1, 1, 1], 2);
      positions.set([1, 1], 65535 * 2);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
      gl.enable(gl.CULL_FACE);
      gl.viewport(0, 0, 16, 64);
      gl.uniform4f(color, 1, 0, 0, 1);
      expectError('strip first vertex', () => gl.drawArrays(gl.TRIANGLE_STRIP, 1, 4), gl.NO_ERROR);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      const paths = [
        [gl.UNSIGNED_BYTE, new Uint8Array([0, 1, 2, 3, 4]), 1, green],
        [gl.UNSIGNED_SHORT, new Uint16Array([0, 1, 2, 3, 4]), 2, blue],
        [gl.UNSIGNED_SHORT, new Uint16Array([0, 1, 2, 3, 65535]), 2, [255, 255, 0, 255]],
      ] as const;
      for (const [index, [type, data, offset, rgba]] of paths.entries()) {
        gl.viewport((index + 1) * 16, 0, 16, 64);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.uniform4f(color, rgba[0]! / 255, rgba[1]! / 255, rgba[2]! / 255, 1);
        expectError(`indexed strip ${index}`, () => gl.drawElements(gl.TRIANGLE_STRIP, 4, type, offset), gl.NO_ERROR);
      }
      if (!hooks) {
        const lastBand = new Uint8Array(16 * 64 * 4);
        gl.readPixels(48, 0, 16, 64, gl.RGBA, gl.UNSIGNED_BYTE, lastBand);
        let yellowPixels = 0;
        for (let offset = 0; offset < lastBand.length; offset += 4) {
          if (lastBand[offset] === 255 && lastBand[offset + 1] === 255) yellowPixels++;
        }
        result.observations.index65535YellowPixels = yellowPixels;
      }
      expectError('indexed strip negative offset', () => gl.drawElements(gl.TRIANGLE_STRIP, 4, gl.UNSIGNED_SHORT, -1), gl.INVALID_VALUE);
      expectError('indexed strip byte alignment', () => gl.drawElements(gl.TRIANGLE_STRIP, 4, gl.UNSIGNED_SHORT, 1), gl.INVALID_OPERATION);
      break;
    }
    case 'integer-vertex-attributes': {
      const positions = new Int16Array([
        0, -32768, -32768, 0, 32767, -32768, 0, -32768, 32767, 0, 32767, 32767,
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
      gl.vertexAttribPointer(position, 2, gl.SHORT, true, 6, 2);
      const colorAttribute = gl.getAttribLocation(program, 'a_color');
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.enableVertexAttribArray(colorAttribute);
      gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(Array.from({ length: 4 }, () => [5, 127, 0, 0, 5]).flat()), gl.STATIC_DRAW);
      const formats = [[gl.BYTE, true], [gl.UNSIGNED_BYTE, true], [gl.UNSIGNED_BYTE, false]] as const;
      for (const [index, [type, normalized]] of formats.entries()) {
        gl.vertexAttribPointer(colorAttribute, 3, type, normalized, 5, 1);
        check(`query type ${index}`, gl.getVertexAttrib(colorAttribute, gl.VERTEX_ATTRIB_ARRAY_TYPE), type);
        check(`query normalization ${index}`, gl.getVertexAttrib(colorAttribute, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED), normalized);
        gl.viewport(index * 16, 0, 16, 64);
        expectError(`integer strip ${index}`, () => gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4), gl.NO_ERROR);
      }
      gl.bufferData(gl.ARRAY_BUFFER, new Uint16Array([0, 65535, 0, 0, 65535, 0, 0, 65535, 0, 0, 65535, 0]), gl.STATIC_DRAW);
      gl.vertexAttribPointer(colorAttribute, 3, gl.UNSIGNED_SHORT, true, 0, 0);
      gl.viewport(48, 0, 16, 64);
      expectError('packed ushort strip', () => gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4), gl.NO_ERROR);
      expectError('ushort offset alignment', () => gl.vertexAttribPointer(colorAttribute, 3, gl.UNSIGNED_SHORT, true, 0, 1), gl.INVALID_OPERATION);
      break;
    }
    case 'enabled-array-validation': {
      gl.enableVertexAttribArray(1);
      expectError('unused enabled array without a buffer', () => gl.drawArrays(gl.TRIANGLES, 0, 6), gl.INVALID_OPERATION);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Int16Array([1]), gl.STATIC_DRAW);
      gl.vertexAttribPointer(1, 1, gl.SHORT, false, 0, 0);
      expectError('unused enabled array with short storage', () => draw(0, 1, 0), gl.NO_ERROR);
      break;
    }
    case 'float-uniform-setters': {
      const locations = ['u_r', 'u_gb', 'u_rgb', 'u_rgba'].map(name => gl.getUniformLocation(program, name)!);
      check('all float uniform locations exist', locations.every(location => location !== null), true);
      const setters = [
        () => gl.uniform1f(locations[0]!, 1),
        () => { const data = new Float32Array([0.5]); gl.uniform1fv(locations[0]!, data); data.fill(0); },
        () => gl.uniform2f(locations[1]!, 0, 1),
        () => { const data = new Float32Array([1, 0]); gl.uniform2fv(locations[1]!, data); data.fill(0); },
        () => gl.uniform3f(locations[2]!, 0, 0, 1),
        () => { const data = new Float32Array([0, 1, 0]); gl.uniform3fv(locations[2]!, data); data.fill(0); },
        () => gl.uniform4f(locations[3]!, 1, 1, 0, 1),
        () => { const data = new Float32Array([0, 1, 1, 1]); gl.uniform4fv(locations[3]!, data); data.fill(0); },
      ];
      for (let index = 0; index < setters.length; index++) {
        gl.uniform1f(locations[0]!, 0); gl.uniform2f(locations[1]!, 0, 0);
        gl.uniform3f(locations[2]!, 0, 0, 0); gl.uniform4f(locations[3]!, 0, 0, 0, 0);
        setters[index]!();
        gl.viewport(index * 8, 0, 8, 64);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        check(`float setter ${index}: error`, gl.getError(), gl.NO_ERROR);
      }
      check('last uniform snapshot', Array.from(gl.getUniform(program, locations[3]!) as Float32Array), [0, 1, 1, 1]);
      break;
    }
    case 'indexed-update-u8':
    case 'indexed-update-u16': {
      const vertices = new Float32Array([-1, -1, 0, -1, -1, 1, 0, 1, ...Array(8).fill(3)]);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
      const indices = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
      const firstIndices = name.endsWith('u8') ? new Uint8Array([0, 1, 2, 2, 1, 3])
        : new Uint16Array([0, 1, 2, 2, 1, 3]);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, firstIndices, gl.DYNAMIC_DRAW);
      firstIndices.fill(0);
      const type = name.endsWith('u8') ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT;
      gl.uniform4f(color, 1, 0, 0, 1);
      gl.drawElements(gl.TRIANGLES, 6, type, 0);
      const update = new Float32Array([90, 0, -1, 1, -1, 0, 1, 1, 1, 91]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 32, update.subarray(1, 9));
      update.fill(0);
      const updatedIndices = name.endsWith('u8') ? new Uint8Array([90, 4, 5, 6, 6, 5, 7, 91])
        : new Uint16Array([90, 4, 5, 6, 6, 5, 7, 91]);
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, updatedIndices.subarray(1, 7));
      updatedIndices.fill(0);
      gl.uniform4f(color, 0, 1, 0, 1);
      gl.drawElements(gl.TRIANGLES, 6, type, 0);
      check('vertex bytes after subrange update', gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE), 64);
      check('index bytes after subrange update', gl.getBufferParameter(gl.ELEMENT_ARRAY_BUFFER, gl.BUFFER_SIZE), name.endsWith('u8') ? 6 : 12);
      check('element binding wrapper identity', gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING) === indices, true);
      break;
    }
    case 'upload-view-snapshot': {
      const source = new Float32Array([90, 91, ...quad, 92, 93]);
      gl.bufferData(gl.ARRAY_BUFFER, source.subarray(2, 14), gl.STATIC_DRAW);
      source.fill(0);
      check('selected vertex view byte length', gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE), 48);
      draw(0, 0, 1);
      break;
    }
    case 'matrix-attribute-columns': {
      const base = gl.getAttribLocation(program, 'a_color');
      check('matrix base location', base, 1);
      const active = Array.from({ length: gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) as number },
        (_, index) => gl.getActiveAttrib(program, index)).find(attribute => attribute?.name === 'a_color');
      check('matrix reflection type and size', [active?.type, active?.size], [gl.FLOAT_MAT3, 1]);
      const columns = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, columns);
      const bytes = new Uint8Array(6 * 8);
      for (let vertex = 0; vertex < 6; vertex++) bytes.set([255, 0, 0, 0, 0, 255], vertex * 8 + 1);
      gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(base);
      gl.vertexAttribPointer(base, 3, gl.UNSIGNED_BYTE, true, 8, 1);
      gl.vertexAttrib3f(base + 1, 0, 0, 0);
      gl.enableVertexAttribArray(base + 2);
      gl.vertexAttribPointer(base + 2, 3, gl.UNSIGNED_BYTE, true, 8, 4);
      check('third column buffer', gl.getVertexAttrib(base + 2, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING) === columns, true);
      check('third column offset', gl.getVertexAttribOffset(base + 2, gl.VERTEX_ATTRIB_ARRAY_POINTER), 4);
      gl.viewport(0, 0, 32, 64);
      expectError('independent buffered and constant columns', () => gl.drawArrays(gl.TRIANGLES, 0, 6), gl.NO_ERROR);
      gl.disableVertexAttribArray(base);
      gl.vertexAttrib3f(base, 0, 0, 0);
      gl.vertexAttrib3f(base + 1, 0, 1, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([255, 0, 1, 2, 3, 4, 5]), gl.STATIC_DRAW);
      gl.viewport(32, 0, 32, 64);
      expectError('indexed draw with new column values', () => gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_BYTE, 1), gl.NO_ERROR);
      break;
    }
    case 'attribute-layout-and-constants': {
      const interleaved = new Float32Array(24);
      for (let index = 0; index < 6; index++) interleaved.set([90, quad[index * 2]!, quad[index * 2 + 1]!, 91], index * 4);
      gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 4);
      const colorAttribute = gl.getAttribLocation(program, 'a_color');
      check('bound color location', colorAttribute, 1);
      gl.disableVertexAttribArray(colorAttribute);
      gl.vertexAttrib4f(colorAttribute, 1, 0, 1, 1);
      gl.viewport(0, 0, 32, 64);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const constant = new Float32Array([0, 1, 1, 1]);
      gl.vertexAttrib4fv(colorAttribute, constant);
      constant.fill(0);
      gl.viewport(32, 0, 32, 64);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      check('attribute stride', gl.getVertexAttrib(position, gl.VERTEX_ATTRIB_ARRAY_STRIDE), 16);
      check('attribute byte offset', gl.getVertexAttribOffset(position, gl.VERTEX_ATTRIB_ARRAY_POINTER), 4);
      check('attribute buffer wrapper identity', gl.getVertexAttrib(position, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING) === buffer, true);
      check('constant attribute snapshot', Array.from(gl.getVertexAttrib(colorAttribute, gl.CURRENT_VERTEX_ATTRIB) as Float32Array), [0, 1, 1, 1]);
      break;
    }
    case 'buffer-reallocation-and-delete':
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(leftQuad), gl.STATIC_DRAW);
      draw(1, 0, 0);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([...rightQuad, 0, 0]), gl.DYNAMIC_DRAW);
      draw(0, 1, 0);
      check('reallocated vertex byte length', gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE), 56);
      gl.deleteBuffer(buffer);
      check('deleted buffer object', gl.isBuffer(buffer), false);
      check('deleted array binding', gl.getParameter(gl.ARRAY_BUFFER_BINDING), null);
      check('deleted attribute binding', gl.getVertexAttrib(position, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING), null);
      break;
    case 'resize-attribute-size': {
      draw(1, 0, 0);
      canvas.width = 96; canvas.height = 32;
      gl.viewport(0, 0, 96, 32);
      const expanded = new Float32Array(24);
      for (let index = 0; index < 6; index++) expanded.set([quad[index * 2]!, quad[index * 2 + 1]!, 0, 1], index * 4);
      gl.bufferData(gl.ARRAY_BUFFER, expanded, gl.STATIC_DRAW);
      gl.vertexAttribPointer(position, 4, gl.FLOAT, false, 0, 0);
      draw(0, 0, 1);
      check('resized drawing dimensions', [gl.drawingBufferWidth, gl.drawingBufferHeight], [96, 32]);
      check('resized viewport', Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array), [0, 0, 96, 32]);
      check('changed attribute size', gl.getVertexAttrib(position, gl.VERTEX_ATTRIB_ARRAY_SIZE), 4);
      break;
    }
    case 'automatic-submit-and-flush': {
      const before = hooks?.stats.submits ?? 0;
      gl.viewport(0, 0, 16, 64); draw(1, 0, 0);
      await Promise.resolve();
      const afterTask = hooks?.stats.submits ?? 0;
      if (hooks) check('outside-rAF automatic submission', afterTask > before, true);
      await new Promise<void>(resolve => requestAnimationFrame(() => {
        gl.viewport(16, 0, 16, 64); draw(0, 1, 0); resolve();
      }));
      await Promise.resolve();
      const afterRaf = hooks?.stats.submits ?? 0;
      if (hooks) check('inside-rAF automatic submission', afterRaf > afterTask, true);
      gl.viewport(32, 0, 32, 64); draw(0, 0, 1);
      gl.flush();
      if (hooks) check('explicit flush submits synchronously', hooks.stats.submits > afterRaf, true);
      break;
    }
    case 'viewport-clear-regions':
      draw(1, 1, 0);
      gl.viewport(1, 1, 1, 1);
      gl.clearColor(0, 0, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.viewport(0, 0, 32, 32); draw(1, 0, 0);
      gl.viewport(32, 32, 32, 32); draw(0, 1, 0);
      check('viewport origin and dimensions', Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array), [32, 32, 32, 32]);
      break;
    case 'draw-validation-state': {
      gl.uniform4f(color, 1, 1, 0, 1);
      expectError('invalid primitive enum', () => gl.drawArrays(0xdead, 0, 6), gl.INVALID_ENUM);
      expectError('negative vertex count', () => gl.drawArrays(gl.TRIANGLES, 0, -1), gl.INVALID_VALUE);
      expectError('missing element buffer', () => gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0), gl.INVALID_OPERATION);
      expectError('misaligned FLOAT stride', () => gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 3, 0), gl.INVALID_OPERATION);
      expectError('short uniform vector', () => gl.uniform4fv(color, new Float32Array(3)), gl.INVALID_VALUE);
      expectError('negative viewport width', () => gl.viewport(0, 0, -1, 64), gl.INVALID_VALUE);
      check('viewport retained after error', Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array), [0, 0, 64, 64]);
      const indices = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2]), gl.STATIC_DRAW);
      expectError('misaligned index offset', () => gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 1), gl.INVALID_OPERATION);
      expectError('index buffer range', () => gl.drawElements(gl.TRIANGLES, 4, gl.UNSIGNED_SHORT, 0), gl.INVALID_OPERATION);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 20]), gl.STATIC_DRAW);
      expectError('vertex fetch range', () => gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0), gl.INVALID_OPERATION);
      const retainedStride = gl.getVertexAttrib(position, gl.VERTEX_ATTRIB_ARRAY_STRIDE) as number;
      result.observations.rejectedAttributePointer = { actualStride: retainedStride, normativeStride: 0 };
      // Chrome 157 updates its query shadow after rejected pointer calls. The
      // native observation is retained while both cores enforce GLES 2.5.
      if (hooks) check('valid attribute state retained', retainedStride, 0);
      check('array binding retained after errors', gl.getParameter(gl.ARRAY_BUFFER_BINDING) === buffer, true);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      break;
    }
    case 'retained-deletion-and-retirement': {
      gl.viewport(0, 0, 32, 64); draw(1, 0, 0);
      const shader = fragmentShader();
      gl.deleteShader(shader);
      check('deleted attached shader remains live', gl.isShader(shader), true);
      check('retained shader deletion flag', gl.getShaderParameter(shader, gl.DELETE_STATUS), true);
      gl.shaderSource(shader, fragment);
      check('retained shader source', gl.getShaderSource(shader), fragment);
      gl.compileShader(shader);
      check('retained shader can compile', gl.getShaderParameter(shader, gl.COMPILE_STATUS), true);
      check('retained shader operations error', gl.getError(), gl.NO_ERROR);
      gl.deleteProgram(program);
      check('deleted current program remains live', gl.isProgram(program), true);
      check('retained program deletion flag', gl.getProgramParameter(program, gl.DELETE_STATUS), true);
      gl.linkProgram(program);
      check('retained program can relink', gl.getProgramParameter(program, gl.LINK_STATUS), true);
      color = gl.getUniformLocation(program, 'u_color');
      check('retained program uniform location exists', color !== null, true);
      check('retained program attribute location', gl.getAttribLocation(program, 'a_position'), 0);
      check('retained program reset uniform', Array.from(gl.getUniform(program, color!) as Float32Array), [0, 0, 0, 0]);
      check('retained program query error', gl.getError(), gl.NO_ERROR);
      expectError('deleted current program cannot be reselected', () => gl.useProgram(program), gl.INVALID_OPERATION);
      check('rejected reselect retains current program', gl.getParameter(gl.CURRENT_PROGRAM) === program, true);
      gl.viewport(32, 0, 32, 64); draw(0, 1, 0);
      check('deleted current program remains drawable', gl.getError(), gl.NO_ERROR);
      gl.detachShader(program, shader);
      check('detached deleted shader retires', gl.isShader(shader), false);
      check('retired shader query returns null', gl.getShaderParameter(shader, gl.DELETE_STATUS), null);
      check('retired shader query error', gl.getError(), gl.INVALID_VALUE);
      gl.useProgram(null);
      check('unbound deleted program retires', gl.isProgram(program), false);
      check('retired program query returns null', gl.getProgramParameter(program, gl.DELETE_STATUS), null);
      check('retired program query error', gl.getError(), gl.INVALID_VALUE);
      check('retired program uniform lookup returns null', gl.getUniformLocation(program, 'u_color'), null);
      check('retired program uniform lookup error', gl.getError(), gl.INVALID_VALUE);
      expectError('retired program cannot be selected', () => gl.useProgram(program), gl.INVALID_OPERATION);
      check('program retirement clears current wrapper', gl.getParameter(gl.CURRENT_PROGRAM), null);
      break;
    }
    case 'failed-current-program-relink': {
      draw(1, 127 / 255, 0);
      const shader = fragmentShader();
      gl.shaderSource(shader, mismatchedFragment); result.shaders.replacement = mismatchedFragment;
      gl.compileShader(shader);
      check('replacement shader compiles', gl.getShaderParameter(shader, gl.COMPILE_STATUS), true);
      gl.linkProgram(program);
      check('failed link status', gl.getProgramParameter(program, gl.LINK_STATUS), false);
      check('failed link retains current wrapper', gl.getParameter(gl.CURRENT_PROGRAM) === program, true);
      check('failed link is not a GL error', gl.getError(), gl.NO_ERROR);
      expectError('old location after failed link', () => gl.uniform4f(color, 0, 1, 0, 1), gl.INVALID_OPERATION);
      expectError('draw after failed link', () => gl.drawArrays(gl.TRIANGLES, 0, 6), gl.INVALID_OPERATION);
      break;
    }
    case 'successful-relink-reset': {
      gl.viewport(0, 0, 16, 64); draw(1, 0, 0);
      const old = color;
      gl.linkProgram(program);
      color = gl.getUniformLocation(program, 'u_color');
      check('successful link status', gl.getProgramParameter(program, gl.LINK_STATUS), true);
      check('successful link retains current wrapper', gl.getParameter(gl.CURRENT_PROGRAM) === program, true);
      check('successful link creates new location', color !== null && color !== old, true);
      check('successful link resets uniform', Array.from(gl.getUniform(program, color!) as Float32Array), [0, 0, 0, 0]);
      expectError('old location after successful link', () => gl.uniform4f(old, 0, 0, 1, 1), gl.INVALID_OPERATION);
      gl.viewport(16, 0, 16, 64); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.viewport(32, 0, 32, 64); draw(0, 1, 0);
      break;
    }
    case 'shader-source-compile-executable': {
      const shader = fragmentShader();
      gl.viewport(0, 0, 16, 64); draw(1, 0, 0);
      gl.shaderSource(shader, mismatchedFragment); result.shaders.replacement = mismatchedFragment;
      check('source change preserves link status', gl.getProgramParameter(program, gl.LINK_STATUS), true);
      gl.viewport(16, 0, 16, 64); draw(0, 1, 0);
      gl.compileShader(shader);
      check('replacement shader compiles', gl.getShaderParameter(shader, gl.COMPILE_STATUS), true);
      check('compile preserves link status', gl.getProgramParameter(program, gl.LINK_STATUS), true);
      gl.viewport(32, 0, 16, 64); draw(0, 0, 1);
      gl.shaderSource(shader, invalidFragment); result.shaders.invalid = invalidFragment;
      gl.compileShader(shader);
      check('invalid shader fails compile', gl.getShaderParameter(shader, gl.COMPILE_STATUS), false);
      check('failed compile preserves link status', gl.getProgramParameter(program, gl.LINK_STATUS), true);
      gl.viewport(48, 0, 16, 64); draw(1, 1, 1);
      break;
    }
    case 'detached-deleted-shader-executable': {
      gl.viewport(0, 0, 32, 64); draw(1, 0, 0);
      const attached = gl.getAttachedShaders(program)!;
      for (const shader of attached) { gl.detachShader(program, shader); gl.deleteShader(shader); }
      check('all shaders detached', gl.getProgramParameter(program, gl.ATTACHED_SHADERS), 0);
      check('detached shaders deleted', attached.every(shader => !gl.isShader(shader)), true);
      check('shader removal preserves link', gl.getProgramParameter(program, gl.LINK_STATUS), true);
      gl.viewport(32, 0, 32, 64); draw(0, 0, 1);
      break;
    }
    case 'shader-source-code-units': {
      const source = '// \ud800 \u0000 \udc00 \ud83d\ude80\r\n' + vertex;
      const shader = gl.createShader(gl.VERTEX_SHADER)!;
      gl.shaderSource(shader, source); result.shaders.codeUnits = source;
      const returned = gl.getShaderSource(shader)!;
      check('shader source code units preserved', returned, source);
      check('surrogate and NUL prefix', Array.from({ length: 13 }, (_, index) => returned.charCodeAt(index)),
        [47, 47, 32, 0xd800, 32, 0, 32, 0xdc00, 32, 0xd83d, 0xde80, 13, 10]);
      gl.deleteShader(shader);
      break;
    }
  }
  check('final GL error', gl.getError(), gl.NO_ERROR);
}

export async function runDrawingCase(name: DrawingCaseName, backend: DrawingBackend): Promise<DrawingResult> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  document.body.append(canvas);
  const shaders = { vertex, fragment };
  if (name === 'point-sprites') {
    shaders.vertex = 'attribute vec4 a_position; uniform float u_size; void main(){ gl_Position = a_position; gl_PointSize = u_size; }';
    shaders.fragment = `precision mediump float; void main() {
      if (!gl_FrontFacing) gl_FragColor = vec4(1., 0., 1., 1.);
      else if (gl_PointCoord.y < .5) gl_FragColor = gl_PointCoord.x < .5 ? vec4(1.,0.,0.,1.) : vec4(0.,1.,0.,1.);
      else gl_FragColor = gl_PointCoord.x < .5 ? vec4(0.,0.,1.,1.) : vec4(1.,1.,0.,1.);
    }`;
  }
  if (name === 'matrix-attribute-columns') {
    shaders.vertex = `attribute vec2 a_position; attribute mat3 a_color; varying vec4 v_color;
      void main() { gl_Position = vec4(a_position, 0., 1.); v_color = vec4(a_color[0].x, a_color[1].y, a_color[2].z, 1.); }`;
    shaders.fragment = colorsFragment;
  }
  if (name === 'float-uniform-setters') shaders.fragment = uniformsFragment;
  if (name === 'attribute-layout-and-constants' || name === 'integer-vertex-attributes') {
    shaders.vertex = colorsVertex; shaders.fragment = colorsFragment;
  }
  const result: DrawingResult = {
    name, backend, selectedCore: null, checks: [], observations: {}, failure: null, cleanupErrors: [],
    width: 64, height: 64, pixels: [], regions: regions(name), shaders,
    environment: {}, configuration: { width: 64, height: 64, attributes, tolerance: 1 },
    stats: null, validationErrors: [],
  };
  let gl: WebGLRenderingContext | null = null;
  let hooks: TestingHooks | null = null;
  try {
    if (backend === 'native') gl = canvas.getContext('webgl', attributes);
    else {
      const { createWebGLOnWebGPU, getTestingHooks } = await import('@refral/webgl');
      gl = await createWebGLOnWebGPU(canvas, { version: 1, core: backend, attributes });
      hooks = getTestingHooks(gl);
    }
    if (!gl) throw new Error(`Failed to create ${backend} WebGL context`);
    result.selectedCore = hooks?.core ?? 'native';
    result.checks.push({ name: 'selected implementation', actual: result.selectedCore,
      expected: backend, passed: result.selectedCore === backend });
    result.environment = { ...(hooks?.environment ?? { userAgent: navigator.userAgent,
      version: gl.getParameter(gl.VERSION), renderer: gl.getParameter(gl.RENDERER) }),
      attributes: gl.getContextAttributes(), devicePixelRatio: window.devicePixelRatio };
    await execute(name, gl, canvas, hooks, result);
    gl.flush();
    result.width = canvas.width; result.height = canvas.height;
    if (hooks) {
      const capture = await hooks.capture();
      result.width = capture.width; result.height = capture.height; result.pixels = Array.from(capture.data);
      result.stats = { ...hooks.stats }; result.validationErrors = [...hooks.errors];
    } else {
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      result.pixels = Array.from(pixels);
    }
  } catch (error) {
    result.failure = error instanceof Error ? { name: error.name, message: error.message }
      : { name: 'Error', message: String(error) };
  } finally {
    try {
      if (hooks) await hooks.dispose();
      else gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch (error) { result.cleanupErrors.push(String(error)); }
    canvas.remove();
  }
  return result;
}

import { prepareRttContext, rttProgram, rttVertex } from './rtt-cases';
import type { DrawingBackend, DrawingCheck } from './dual-core-cases';

export const cubemapCaseNames = [
  'target-bindings-and-wrapper-identity',
  'six-axes-and-face-corners',
  'completeness-and-npot',
  'typed-five-formats-and-snapshots',
  'dom-face-sources-and-pixel-store',
  'ordered-face-updates-and-redefinition',
  'sampling-parameter-snapshots',
  'mixed-sampler-units',
  'deletion-cross-context-and-error-state',
  'framebuffer-target-boundary',
] as const;
export type CubemapCaseName = typeof cubemapCaseNames[number];

export const cubemapSources = {
  specification: 'https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html',
  cubeSelection: 'https://registry.khronos.org/OpenGL/specs/es/2.0/es_full_spec_2.0.pdf',
  imageDataGenerator: 'https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/js/tests/tex-image-and-sub-image-2d-with-image-data.js',
  canvasGenerator: 'https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/js/tests/tex-image-and-sub-image-2d-with-canvas.js',
};

interface PixelSample { name: string; x: number; y: number; direction: number[]; color: number[] }
export interface CubemapResult {
  name: CubemapCaseName;
  backend: DrawingBackend;
  selectedCore: DrawingBackend | null;
  checks: DrawingCheck[];
  samples: PixelSample[];
  environment: Record<string, unknown>;
  observations: Record<string, unknown>;
  shaders: Record<string, string>;
  width: number;
  height: number;
  pixels: number[];
  expected: number[];
  failure: { name: string; message: string } | null;
  validationErrors: string[];
  cleanupErrors: string[];
}

type Context = Awaited<ReturnType<typeof prepareRttContext>>;
type Color = readonly number[];
const width = 80;
const height = 32;
const cellSize = 4;
const black = [0, 0, 0, 255];
const red = [255, 0, 0, 255];
const green = [0, 255, 0, 255];
const blue = [0, 0, 255, 255];
const white = [255, 255, 255, 255];
const faceColors = [red, green, blue, [255, 255, 0, 255], [255, 0, 255, 255], [0, 255, 255, 255]];
const cubeFragment = 'precision highp float; uniform samplerCube u_cube; uniform vec3 u_direction; void main(){gl_FragColor=textureCube(u_cube,u_direction);}';
const mixedFragment = 'precision highp float; uniform samplerCube u_cube; uniform sampler2D u_2d; uniform vec3 u_direction; void main(){gl_FragColor=vec4(textureCube(u_cube,u_direction).rgb+texture2D(u_2d,vec2(0.5)).rgb,1.0);}';

function faces(gl: WebGLRenderingContext): number[] {
  return [gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
    gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
    gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z];
}

/** Invert GLES 2.0 table 3.19. Image row zero has t=0 before unpack flipping. */
function direction(face: number, s = 0.5, t = 0.5): number[] {
  const sc = s * 2 - 1;
  const tc = t * 2 - 1;
  switch (face) {
    case 0: return [1, -tc, -sc];
    case 1: return [-1, -tc, sc];
    case 2: return [sc, 1, tc];
    case 3: return [sc, -1, -tc];
    case 4: return [sc, -tc, 1];
    case 5: return [-sc, -tc, -1];
    default: throw new Error(`Invalid cube face ${face}`);
  }
}

function repeated(color: Color, count: number): Uint8Array {
  const bytes = new Uint8Array(count * color.length);
  for (let pixel = 0; pixel < count; pixel++) bytes.set(color, pixel * color.length);
  return bytes;
}

function cube(gl: WebGLRenderingContext, size = 1, color: Color = red, parameters = true): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
  for (const face of faces(gl)) {
    gl.texImage2D(face, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, repeated(color, size * size));
  }
  if (parameters) {
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  return texture;
}

async function execute(result: CubemapResult, context: Context) {
  const { gl } = context;
  const check = (name: string, actual: unknown, expected: unknown) => {
    result.checks.push({ name, actual, expected, passed: JSON.stringify(actual) === JSON.stringify(expected) });
  };
  const error = (name: string, operation: () => void, expected: number) => {
    operation();
    check(name, gl.getError(), expected);
  };
  const makeProgram = (fragment = cubeFragment) => {
    result.shaders[`fragment-${Object.keys(result.shaders).length}`] = fragment;
    return rttProgram(gl, rttVertex, fragment);
  };
  const program = makeProgram();
  const faceTargets = faces(gl);
  const sample = (name: string, color: Color, face = 0, s = 0.5, t = 0.5,
    activeProgram = program, expectedError: number = gl.NO_ERROR) => {
    const index = result.samples.length;
    const x = (index % (width / cellSize)) * cellSize;
    const y = Math.floor(index / (width / cellSize)) * cellSize;
    if (y + cellSize > height) throw new Error('Cube fixture exceeded its pixel surface.');
    const vector = direction(face, s, t);
    gl.useProgram(activeProgram);
    gl.uniform3fv(gl.getUniformLocation(activeProgram, 'u_direction'), vector);
    gl.viewport(x, y, cellSize, cellSize);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    check(`${name} draw error`, gl.getError(), expectedError);
    result.samples.push({ name, x, y, direction: vector, color: Array.from(color) });
    for (let row = y; row < y + cellSize; row++) {
      for (let column = x; column < x + cellSize; column++) result.expected.splice((row * width + column) * 4, 4, ...color);
    }
  };
  const corners = (name: string, colors: readonly Color[], face = 0) => {
    for (let corner = 0; corner < 4; corner++) {
      sample(`${name} corner ${corner}`, colors[corner]!, face,
        corner % 2 ? 0.75 : 0.25, corner < 2 ? 0.25 : 0.75);
    }
  };
  const define = (face: number, size: number, color: Color = red, format: number = gl.RGBA) => {
    gl.texImage2D(faceTargets[face]!, 0, format, size, size, 0, format, gl.UNSIGNED_BYTE, repeated(color, size * size));
  };
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform1i(gl.getUniformLocation(program, 'u_cube'), 0);

  switch (result.name) {
    case 'target-bindings-and-wrapper-identity': {
      const twoD = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, twoD);
      const texture = cube(gl);
      check('2D and cube have independent wrapper bindings', gl.getParameter(gl.TEXTURE_BINDING_2D) === twoD, true);
      check('cube getter returns original wrapper', gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP) === texture, true);
      check('bound cube is a texture', gl.isTexture(texture), true);
      check('cube maximum is positive', gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE) > 0, true);
      error('cube cannot be rebound as 2D', () => gl.bindTexture(gl.TEXTURE_2D, texture), gl.INVALID_OPERATION);
      check('failed rebinding keeps 2D wrapper', gl.getParameter(gl.TEXTURE_BINDING_2D) === twoD, true);
      error('2D cannot be rebound as cube', () => gl.bindTexture(gl.TEXTURE_CUBE_MAP, twoD), gl.INVALID_OPERATION);
      check('failed rebinding keeps cube wrapper', gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP) === texture, true);
      gl.activeTexture(gl.TEXTURE1);
      check('another unit starts with null cube binding', gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP), null);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
      check('same object wrapper across units', gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP) === texture, true);
      gl.activeTexture(gl.TEXTURE0);
      error('face is invalid for binding', () => gl.bindTexture(faceTargets[0]!, null), gl.INVALID_ENUM);
      error('whole cube is invalid for image definition', () => gl.texImage2D(gl.TEXTURE_CUBE_MAP,
        0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(red)), gl.INVALID_ENUM);
      error('face is invalid for parameter assignment', () => gl.texParameteri(faceTargets[0]!,
        gl.TEXTURE_MIN_FILTER, gl.LINEAR), gl.INVALID_ENUM);
      check('rejected parameter retains nearest', gl.getTexParameter(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER), gl.NEAREST);
      sample('bindings survive rejected operations', red);
      break;
    }
    case 'six-axes-and-face-corners': {
      cube(gl);
      for (let face = 0; face < 6; face++) define(face, 1, faceColors[face]!);
      for (let face = 0; face < 6; face++) sample(`axis ${face}`, faceColors[face]!, face);
      for (let face = 0; face < 6; face++) {
        const palette = [faceColors[face]!, faceColors[(face + 1) % 6]!, black, white];
        gl.texImage2D(faceTargets[face]!, 0, gl.RGBA, 2, 2, 0, gl.RGBA,
          gl.UNSIGNED_BYTE, new Uint8Array(palette.flat()));
      }
      for (let face = 0; face < 6; face++) {
        corners(`face ${face}`, [faceColors[face]!, faceColors[(face + 1) % 6]!, black, white], face);
      }
      break;
    }
    case 'completeness-and-npot': {
      cube(gl, 1, red, false);
      check('default minification filter', gl.getTexParameter(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER), gl.NEAREST_MIPMAP_LINEAR);
      sample('one pixel faces complete with default mip filter', red);
      cube(gl, 2, red, false);
      sample('two pixel faces need mip chain with default filter', black);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      sample('nonmip filter completes level zero cube', red);
      const incomplete = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, incomplete);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      for (let face = 0; face < 5; face++) define(face, 1);
      sample('missing face is opaque black', black);
      define(5, 1);
      sample('last face completes cube', red);
      define(5, 2);
      sample('dimension mismatch is opaque black', black);
      define(5, 1, [255, 0, 0], gl.RGB);
      sample('logical format mismatch is opaque black', black);
      define(5, 1);
      gl.texImage2D(faceTargets[5]!, 0, gl.RGBA, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      check('zero-sized face definition succeeds', gl.getError(), gl.NO_ERROR);
      sample('zero-sized face is incomplete', black);
      define(5, 1);
      error('nonsquare face rejected', () => gl.texImage2D(faceTargets[5]!, 0, gl.RGBA,
        2, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(8)), gl.INVALID_VALUE);
      sample('rejected nonsquare definition retains image', red);
      cube(gl, 3, green, false);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      sample('NPOT repeat remains incomplete', black);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      sample('NPOT requires both wrap axes', black);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      sample('NPOT nearest clamp completes cube', green);
      break;
    }
    case 'typed-five-formats-and-snapshots': {
      const formats = [
        { value: gl.RGBA, source: [128, 64, 32, 128], expected: [128, 64, 32, 128], zero: [0, 0, 0, 0] },
        { value: gl.RGB, source: [128, 64, 32], expected: [128, 64, 32, 255], zero: black },
        { value: gl.ALPHA, source: [128], expected: [0, 0, 0, 128], zero: [0, 0, 0, 0] },
        { value: gl.LUMINANCE, source: [128], expected: [128, 128, 128, 255], zero: black },
        { value: gl.LUMINANCE_ALPHA, source: [128, 64], expected: [128, 128, 128, 64], zero: [0, 0, 0, 0] },
      ];
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      for (const format of formats) {
        const texture = cube(gl, 2);
        const rowBytes = format.source.length * 2;
        const stride = Math.ceil(rowBytes / 4) * 4;
        const length = stride + rowBytes;
        const buffer = new Uint8Array(length + 4);
        buffer.fill(239);
        const source = buffer.subarray(3, 3 + length);
        for (let row = 0; row < 2; row++) {
          source.set(format.source, row * stride);
          source.set(format.source, row * stride + format.source.length);
        }
        for (const face of faceTargets) gl.texImage2D(face, 0, format.value, 2, 2, 0,
          format.value, gl.UNSIGNED_BYTE, source);
        buffer.fill(0);
        for (let face = 0; face < 6; face++) sample(`format ${format.value} snapshotted face ${face}`, format.expected, face, 0.25, 0.75);
        for (const face of faceTargets) gl.texImage2D(face, 0, format.value, 2, 2, 0,
          format.value, gl.UNSIGNED_BYTE, null);
        sample(`format ${format.value} null zero initialization`, format.zero);
        gl.deleteTexture(texture);
      }
      break;
    }
    case 'dom-face-sources-and-pixel-store': {
      const palette = [128, 0, 0, 128, 0, 128, 0, 64, 0, 0, 255, 0, 255, 255, 255, 255];
      cube(gl, 2);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 8);
      for (const flip of [false, true]) {
        for (const premultiply of [false, true]) {
          const source = new ImageData(new Uint8ClampedArray(palette), 2, 2, { colorSpace: 'srgb' });
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, Number(flip));
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, Number(premultiply));
          gl.texImage2D(faceTargets[0]!, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
          source.data.fill(0);
          const colors: number[][] = [];
          for (let pixel = 0; pixel < 4; pixel++) {
            const sourcePixel = flip ? (1 - Math.floor(pixel / 2)) * 2 + pixel % 2 : pixel;
            const color = palette.slice(sourcePixel * 4, sourcePixel * 4 + 4);
            if (premultiply) for (let channel = 0; channel < 3; channel++) color[channel] = Math.round(color[channel]! * color[3]! / 255);
            colors.push(color);
          }
          corners(`ImageData flip ${flip} premultiply ${premultiply}`, colors);
        }
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const canvasContext = canvas.getContext('2d')!;
      const opaquePalette = [...red, ...green, ...blue, ...white];
      canvasContext.putImageData(new ImageData(new Uint8ClampedArray(opaquePalette), 2, 2), 0, 0);
      const imageUrl = canvas.toDataURL();
      gl.texImage2D(faceTargets[1]!, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      canvas.width = 4;
      corners('HTMLCanvas source snapshot before resize', [red, green, blue, white], 1);
      check('OffscreenCanvas is available', typeof OffscreenCanvas, 'function');
      const offscreen = new OffscreenCanvas(2, 2);
      offscreen.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(opaquePalette), 2, 2), 0, 0);
      gl.texImage2D(faceTargets[2]!, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreen);
      offscreen.width = 4;
      corners('OffscreenCanvas source snapshot before resize', [red, green, blue, white], 2);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Cube face data URL failed to decode.'));
        image.src = imageUrl;
      });
      gl.texImage2D(faceTargets[3]!, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      image.src = '';
      corners('HTMLImage source snapshot before source change', [red, green, blue, white], 3);
      break;
    }
    case 'ordered-face-updates-and-redefinition': {
      const texture = cube(gl, 2);
      sample('initial positive X draw', red);
      const update = new Uint8Array(green);
      gl.texSubImage2D(faceTargets[0]!, 0, 0, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, update);
      update.fill(0);
      corners('rectangular single-face update', [red, red, green, red]);
      sample('other face retains original content', red, 1);
      define(0, 1, blue);
      sample('single face resize makes aggregate incomplete', black);
      for (let face = 1; face < 6; face++) define(face, 1, green);
      sample('resized positive X uses latest storage', blue);
      sample('resized negative X uses its storage', green, 1);
      define(0, 1, white);
      sample('second redefinition replaces cache', white);
      gl.deleteTexture(texture);
      sample('delete after queued draws retains earlier pixels', black);
      break;
    }
    case 'sampling-parameter-snapshots': {
      cube(gl, 2);
      const palette = new Uint8Array([0, 0, 0, 255, 128, 0, 0, 255, 0, 0, 0, 255, 128, 0, 0, 255]);
      for (const face of faceTargets) gl.texImage2D(face, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, palette);
      sample('nearest selects lower texel', black, 0, 0.25, 0.5);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      sample('linear interpolates between texels', [64, 0, 0, 255]);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
      sample('mip parameter change invalidates completeness cache', black);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      sample('nearest restore invalidates sampler cache', [128, 0, 0, 255], 0, 0.75, 0.5);
      error('invalid sampling parameter rejected', () => gl.texParameteri(gl.TEXTURE_CUBE_MAP,
        gl.TEXTURE_WRAP_S, gl.LINEAR), gl.INVALID_ENUM);
      check('invalid wrap leaves clamp', gl.getTexParameter(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S), gl.CLAMP_TO_EDGE);
      break;
    }
    case 'mixed-sampler-units': {
      const mixed = makeProgram(mixedFragment);
      const texture = cube(gl, 1, [128, 0, 0, 255]);
      const twoD = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, twoD);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 128, 0, 255]));
      gl.uniform1i(gl.getUniformLocation(mixed, 'u_cube'), 0);
      gl.uniform1i(gl.getUniformLocation(mixed, 'u_2d'), 0);
      check('sampler uniform assignment succeeds', gl.getError(), gl.NO_ERROR);
      gl.validateProgram(mixed);
      check('sampler types sharing a unit fail validation', gl.getProgramParameter(mixed, gl.VALIDATE_STATUS), false);
      sample('sampler type conflict rejects draw', [0, 0, 0, 0], 0, 0.5, 0.5, mixed, gl.INVALID_OPERATION);
      error('sampler conflict precedes zero-count draw return', () => gl.drawArrays(gl.TRIANGLES, 0, 0), gl.INVALID_OPERATION);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
      gl.uniform1i(gl.getUniformLocation(mixed, 'u_cube'), 1);
      gl.validateProgram(mixed);
      check('distinct sampler units validate', gl.getProgramParameter(mixed, gl.VALIDATE_STATUS), true);
      sample('independent 2D and cube units draw', [128, 128, 0, 255], 0, 0.5, 0.5, mixed);
      error('out-of-range sampler assignment rejected', () => gl.uniform1i(gl.getUniformLocation(mixed, 'u_cube'),
        gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS)), gl.INVALID_VALUE);
      check('rejected sampler assignment preserves unit', gl.getUniform(mixed, gl.getUniformLocation(mixed, 'u_cube')!), 1);
      gl.validateProgram(mixed);
      check('rejected sampler assignment preserves validation', gl.getProgramParameter(mixed, gl.VALIDATE_STATUS), true);
      sample('rejected sampler assignment preserves drawing', [128, 128, 0, 255], 0, 0.5, 0.5, mixed);
      break;
    }
    case 'deletion-cross-context-and-error-state': {
      const texture = cube(gl);
      sample('draw before deletion', red);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
      gl.activeTexture(gl.TEXTURE0);
      gl.deleteTexture(texture);
      check('deleted object is not a live texture', gl.isTexture(texture), false);
      check('deletion clears current unit binding', gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP), null);
      gl.activeTexture(gl.TEXTURE1);
      check('deletion clears other unit binding', gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP), null);
      gl.activeTexture(gl.TEXTURE0);
      error('deleted wrapper cannot be rebound', () => gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture), gl.INVALID_OPERATION);
      sample('unbound cube samples opaque black', black);
      const replacement = cube(gl, 1, green);
      const peer = await prepareRttContext(result.backend, 2, 2);
      try {
        const foreign = cube(peer.gl, 1, blue);
        error('foreign cube binding rejected', () => gl.bindTexture(gl.TEXTURE_CUBE_MAP, foreign), gl.INVALID_OPERATION);
        check('foreign bind preserves own wrapper', gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP) === replacement, true);
        check('foreign texture query returns false', gl.isTexture(foreign), false);
        check('foreign texture query error', gl.getError(), gl.NO_ERROR);
        error('foreign texture deletion rejected', () => gl.deleteTexture(foreign), gl.INVALID_OPERATION);
        error('subimage overflow rejected', () => gl.texSubImage2D(faceTargets[0]!, 0, 1, 0,
          1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(red)), gl.INVALID_VALUE);
        sample('failed foreign and subimage operations preserve content', green);
        error('stale wrapper remains invalid after replacement', () => gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture), gl.INVALID_OPERATION);
        sample('replacement generation retains content', green);
      } finally { await peer.dispose(); }
      break;
    }
    case 'framebuffer-target-boundary': {
      const texture = cube(gl);
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      error('cube object cannot be attached with 2D target', () => gl.framebufferTexture2D(gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0), gl.INVALID_OPERATION);
      check('rejected target leaves missing attachment', gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT);
      if (result.backend === 'native') {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, faceTargets[0]!, texture, 0);
        check('native legal cube face attachment succeeds', gl.getError(), gl.NO_ERROR);
        check('native cube face framebuffer is complete', gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
        result.observations.cubeFaceAttachment = 'supported by native WebGL';
      } else {
        let diagnostic: { name: string; message: string } | null = null;
        try {
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, faceTargets[0]!, texture, 0);
        } catch (caught) {
          diagnostic = caught instanceof Error ? { name: caught.name, message: caught.message }
            : { name: 'Error', message: String(caught) };
        }
        check('legal cube face attachment reports profile gap', diagnostic?.name, 'NotSupportedError');
        check('profile diagnostic leaves GL errors clear', gl.getError(), gl.NO_ERROR);
        check('profile diagnostic preserves missing attachment', gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT);
        result.observations.cubeFaceAttachment = diagnostic;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      sample('rejected target and profile diagnostic preserve sampling', red);
      break;
    }
  }
  check('final GL error', gl.getError(), gl.NO_ERROR);
  gl.flush();
}

export async function runCubemapCase(name: CubemapCaseName, backend: DrawingBackend): Promise<CubemapResult> {
  const result: CubemapResult = {
    name, backend, selectedCore: null, checks: [], samples: [], environment: {}, observations: {},
    shaders: { vertex: rttVertex }, width, height, pixels: [], expected: Array.from(repeated([0, 0, 0, 0], width * height)),
    failure: null, validationErrors: [], cleanupErrors: [],
  };
  let context: Context | null = null;
  try {
    context = await prepareRttContext(backend, width, height, true);
    result.selectedCore = context.selectedCore;
    result.environment = context.environment;
    const attributes = context.gl.getContextAttributes();
    for (const [attribute, expected] of Object.entries(context.requestedAttributes)) {
      const actual = attributes?.[attribute as keyof WebGLContextAttributes];
      result.checks.push({ name: `context attribute ${attribute}`, actual, expected, passed: actual === expected });
    }
    await execute(result, context);
    const capture = await context.capture();
    result.width = capture.width;
    result.height = capture.height;
    result.pixels = Array.from(capture.data);
  } catch (caught) {
    result.failure = caught instanceof Error ? { name: caught.name, message: caught.message }
      : { name: 'Error', message: String(caught) };
  } finally {
    if (context) {
      try {
        if (context.hooks) await context.hooks.device.queue.onSubmittedWorkDone();
        await new Promise(resolve => setTimeout(resolve, 0));
        result.validationErrors = context.hooks?.errors.slice() ?? [];
      } catch (caught) { result.cleanupErrors.push(String(caught)); }
      try { await context.dispose(); }
      catch (caught) { result.cleanupErrors.push(String(caught)); }
    }
  }
  return result;
}

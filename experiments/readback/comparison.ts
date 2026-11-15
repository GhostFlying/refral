import { GL } from '@refral/core-api';
import type { CoreKind } from '@refral/core-api';
import { createInlineHost } from './inline-host';
import { createScene } from './scene';
import { probeTimer } from './primitives';
import { BrowserHost } from '@refral/browser-host';

export type ComparisonRoute = 'canvas' | 'worker';
export const comparisonWorkloads = [
  { name: 'default-64', width: 64, height: 64, offscreen: false },
  { name: 'default-320', width: 320, height: 240, offscreen: false },
  { name: 'fbo-320', width: 320, height: 240, offscreen: true },
] as const;
export const comparisonSampling = { warmupSamples: 30, samples: 120, framesPerSample: 8, rounds: 3 } as const;

export function createComparisonScene(core: CoreKind, route: ComparisonRoute) {
  return route === 'canvas' ? createScene(core, 'spin', createInlineHost) : createScene(core, 'spin');
}

interface Image {
  width: number;
  height: number;
  data: Uint8Array;
}
interface Client {
  call(operation: string, args?: unknown[]): unknown;
  resize(width: number, height: number): void;
  bindVertex(location: number): void;
  framebuffer: unknown;
  texture: unknown;
  capture(): Image;
  error(): number;
}

function texturedProgram(client: Client) {
  const sources = [
    [
      GL.VERTEX_SHADER,
      'attribute vec2 a_position; varying vec2 v_uv; void main(){gl_Position=vec4(a_position,0.,1.);v_uv=a_position*.5+.5;}',
    ],
    [
      GL.FRAGMENT_SHADER,
      'precision mediump float; varying vec2 v_uv; uniform sampler2D u_image; void main(){gl_FragColor=texture2D(u_image,v_uv);}',
    ],
  ] as const;
  const program = client.call('createProgram');
  for (const [stage, source] of sources) {
    const shader = client.call('createShader', [stage]);
    client.call('shaderSource', [shader, source]);
    client.call('compileShader', [shader]);
    if (!client.call('getShaderParameter', [shader, GL.COMPILE_STATUS]))
      throw new Error('Corpus shader compile failed.');
    client.call('attachShader', [program, shader]);
  }
  client.call('linkProgram', [program]);
  if (!client.call('getProgramParameter', [program, GL.LINK_STATUS])) throw new Error('Corpus program link failed.');
  client.call('useProgram', [program]);
  const location = client.call('getAttribLocation', [program, 'a_position']) as number;
  client.bindVertex(location);
  client.call('uniform1i', [client.call('getUniformLocation', [program, 'u_image']), 0]);
}

function palette(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  const edges = [0, 1, 254, 255];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      bytes.set([(x + 37) & 255, (x * 29 + 100) & 255, edges[(x + y) % 4]!, (x + y) & 255], (y * width + x) * 4);
    }
  }
  return bytes;
}

function checkImage(name: string, image: Image, expected: Uint8Array) {
  if (image.data.byteLength !== expected.byteLength) throw new Error(`${name} has incorrect dimensions.`);
  let mismatchedChannels = 0;
  let hash = 2166136261;
  for (let index = 0; index < expected.length; index++) {
    const value = image.data[index]!;
    if (value !== expected[index]) mismatchedChannels++;
    hash = Math.imul(hash ^ value, 16777619) >>> 0;
  }
  return { name, width: image.width, height: image.height, bytes: expected.length, mismatchedChannels, hash };
}

function runTextureCorpus(client: Client, width: number, height: number) {
  const records: ReturnType<typeof checkImage>[] = [];
  const call = client.call;
  client.resize(width, height);
  call('disable', [GL.SCISSOR_TEST]);
  call('bindFramebuffer', [GL.FRAMEBUFFER, client.framebuffer]);
  call('bindTexture', [GL.TEXTURE_2D, client.texture]);
  call('texImage2D', [GL.TEXTURE_2D, 0, GL.RGBA, width, height, 0, GL.RGBA, GL.UNSIGNED_BYTE, null]);
  records.push(checkImage('zero-initialized', client.capture(), new Uint8Array(width * height * 4)));
  texturedProgram(client);
  const source = call('createTexture');
  call('bindTexture', [GL.TEXTURE_2D, source]);
  for (const [parameter, value] of [
    [GL.TEXTURE_MIN_FILTER, GL.NEAREST],
    [GL.TEXTURE_MAG_FILTER, GL.NEAREST],
    [GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE],
    [GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE],
  ])
    call('texParameteri', [GL.TEXTURE_2D, parameter, value]);
  const expected = palette(width, height);
  const upload = new Uint8Array(expected.length + 13).subarray(5, 5 + expected.length);
  upload.set(expected);
  call('texImage2D', [GL.TEXTURE_2D, 0, GL.RGBA, width, height, 0, GL.RGBA, GL.UNSIGNED_BYTE, upload]);
  upload.fill(0);
  call('viewport', [0, 0, width, height]);
  call('drawArrays', [GL.TRIANGLES, 0, 6]);
  const retained = client.capture();
  records.push(checkImage('rgba-palette-upload-snapshot', retained, expected));
  records.push(checkImage('repeat-read', client.capture(), expected));
  call('texSubImage2D', [GL.TEXTURE_2D, 0, 0, 0, -1, 1, GL.RGBA, GL.UNSIGNED_BYTE, new Uint8Array(4)]);
  if (client.error() !== GL.INVALID_VALUE) throw new Error('Invalid texture update produced the wrong error.');
  records.push(checkImage('state-after-invalid-upload', client.capture(), expected));
  call('drawArrays', [GL.TRIANGLES, 0, 6]);
  const update = new Uint8Array(expected.length);
  for (let index = 0; index < update.length; index += 4) update.set([255, 1, 254, 0], index);
  call('texSubImage2D', [GL.TEXTURE_2D, 0, 0, 0, width, height, GL.RGBA, GL.UNSIGNED_BYTE, update]);
  update.fill(0);
  const middle = Math.floor(width / 2);
  call('enable', [GL.SCISSOR_TEST]);
  call('scissor', [middle, 0, width - middle, height]);
  call('drawArrays', [GL.TRIANGLES, 0, 6]);
  call('disable', [GL.SCISSOR_TEST]);
  const mixed = expected.slice();
  for (let y = 0; y < height; y++) {
    for (let x = middle; x < width; x++) mixed.set([255, 1, 254, 0], (y * width + x) * 4);
  }
  records.push(checkImage('draw-update-draw', client.capture(), mixed));
  records.push(checkImage('owned-earlier-result', retained, expected));
  call('bindFramebuffer', [GL.FRAMEBUFFER, null]);
  call('bindTexture', [GL.TEXTURE_2D, client.texture]);
  call('texParameteri', [GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST]);
  call('texParameteri', [GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE]);
  call('texParameteri', [GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE]);
  call('drawArrays', [GL.TRIANGLES, 0, 6]);
  call('deleteTexture', [client.texture]);
  const opaque = mixed.slice();
  for (let index = 3; index < opaque.length; index += 4) opaque[index] = 255;
  records.push(checkImage('fbo-sample-delete-before-capture', client.capture(), opaque));
  call('deleteTexture', [source]);
  if (client.error() !== GL.NO_ERROR) throw new Error('Texture corpus produced a GL error.');
  return records;
}

export async function runComparisonCorpus(core: CoreKind, route: ComparisonRoute) {
  const scene = await createComparisonScene(core, route);
  try {
    const frames = [];
    for (const [width, height] of [
      [64, 64],
      [320, 240],
    ] as const) {
      for (const offscreen of [false, true]) {
        for (let frame = 0; frame < 3; frame++) frames.push(scene.frame(frame, width, height, offscreen));
      }
    }
    const client: Client = {
      call(operation, args = []) {
        if ((operation === 'texImage2D' || operation === 'texSubImage2D') && ArrayBuffer.isView(args[8])) {
          args = [...args];
          args[8] = { bytes: args[8], viewType: 'Uint8Array' };
        }
        return scene.call(operation, args);
      },
      resize(width, height) {
        scene.surface.width = width;
        scene.surface.height = height;
        scene.resize(width, height);
      },
      bindVertex(location) {
        scene.core.bindBuffer(GL.ARRAY_BUFFER, scene.buffer);
        scene.call('enableVertexAttribArray', [location]);
        scene.call('vertexAttribPointer', [location, 2, GL.FLOAT, false, 0, 0]);
      },
      texture: scene.texture,
      framebuffer: scene.framebuffer,
      capture: scene.capture,
      error: () => scene.core.getError(),
    };
    const images = runTextureCorpus(client, 257, 7);
    const diagnostics = await scene.inspect();
    return {
      core: scene.selectedCore,
      route,
      environment: scene.environment,
      crossOriginIsolated,
      frames,
      images,
      diagnostics,
    };
  } finally {
    await scene.dispose();
  }
}

export function runNativeCorpus() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { alpha: false, depth: true, antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('Native WebGL unavailable.');
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const client: Client = {
    call(operation, args = []) {
      return Reflect.apply(Reflect.get(gl, operation), gl, args);
    },
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
    },
    bindVertex(location) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    },
    texture,
    framebuffer,
    capture() {
      const data = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return { width: canvas.width, height: canvas.height, data };
    },
    error: () => gl.getError(),
  };
  try {
    return { images: runTextureCorpus(client, 257, 7), attributes: gl.getContextAttributes() };
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export async function probeCanvasTiles() {
  const host = await BrowserHost.create(new OffscreenCanvas(1, 1), { alpha: false, depth: false });
  try {
    const records = [];
    for (const [width, height] of [
      [Math.floor(host.limits.maxTextureDimension2D / 2) + 3, 1],
      [1, 3],
    ]) {
      const expected = palette(width!, height!);
      const target = {
        color: { width: width!, height: height!, generation: 1, data: expected.slice() },
        depth: null,
        depthGeneration: 0,
        width: width!,
        height: height!,
        isDefault: false,
      };
      records.push(checkImage('canvas-tiled', host.captureCanvas(target), expected));
      records.push(checkImage('map-reference-after-canvas', await host.capture(target), expected));
    }
    const empty = host.captureCanvas({
      color: null,
      depth: null,
      depthGeneration: 0,
      width: 0,
      height: 0,
      isDefault: true,
    });
    await host.device.queue.onSubmittedWorkDone();
    return {
      records,
      emptyBytes: empty.data.byteLength,
      stats: { ...host.canvasReadbackStats },
      errors: [...host.errors],
      limit: host.limits.maxTextureDimension2D,
    };
  } finally {
    await host.dispose();
  }
}

let active: Awaited<ReturnType<typeof createComparisonScene>> | undefined;
let frameIndex = 0;

export async function prepareMeasurement(core: CoreKind, route: ComparisonRoute, workload: number) {
  active = await createComparisonScene(core, route);
  frameIndex = 0;
  const configuration = comparisonWorkloads[workload]!;
  const first = active.frame(frameIndex++, configuration.width, configuration.height, configuration.offscreen, {
    validate: true,
    reallocate: false,
  });
  return {
    core: active.selectedCore,
    route,
    initializationMs: active.initializationMs,
    first,
    environment: active.environment,
    timer: probeTimer(),
    configuration,
    sampling: comparisonSampling,
  };
}

async function samples(count: number, workload: number) {
  if (!active) throw new Error('Measurement scene is unavailable.');
  const configuration = comparisonWorkloads[workload]!;
  const records = [];
  for (let index = 0; index < count; index++) {
    let totalMs = 0;
    let captureMs = 0;
    for (let frame = 0; frame < comparisonSampling.framesPerSample; frame++) {
      const result = active.frame(frameIndex++, configuration.width, configuration.height, configuration.offscreen, {
        validate: false,
        reallocate: false,
      });
      totalMs += result.frameAndReadbackMs;
      captureMs += result.roundTripMs;
    }
    records.push({
      operationMs: totalMs / comparisonSampling.framesPerSample,
      captureMs: captureMs / comparisonSampling.framesPerSample,
    });
    // Permit same-agent GPU completion/retirement callbacks between identical sample groups.
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(0);
    });
  }
  const diagnostics = await active.inspect();
  return { records, diagnostics };
}

export const warmMeasurement = (workload: number) => samples(comparisonSampling.warmupSamples, workload);
export const measure = (workload: number) => samples(comparisonSampling.samples, workload);

export function verifyMeasurement() {
  if (!active) throw new Error('Measurement scene is unavailable.');
  const image = active.lastImage();
  if (!image) throw new Error('No measured image.');
  const expected = new Uint8Array(image.data.length);
  const index = frameIndex - 1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const color =
        y === 0
          ? [0, (index % 2) * 255, 255, 255]
          : x < image.width / 2
            ? [index % 2 ? 0 : 255, index % 2 ? 255 : 0, 0, 255]
            : [index % 2 ? 255 : 0, index % 2 ? 0 : 255, 0, 255];
      expected.set(color, (y * image.width + x) * 4);
    }
  }
  return checkImage('last-measured-image', image, expected);
}

export async function disposeMeasurement() {
  const scene = active;
  active = undefined;
  await scene?.dispose();
}

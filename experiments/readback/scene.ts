import { allocateContextId, ExecutionResources, GL } from '@refral/core-api';
import type {
  CompilerRegistry,
  CoreKind,
  DrawingCore,
  FramebufferHandle,
  ProgramHandle,
  ShaderHandle,
  TextureHandle,
  UniformLocationHandle,
} from '@refral/core-api';
import { createJsDrawingCore } from '@refral/core-js';
import { createRustDrawingCore } from '@refral/core-wasm';
import { COMPILER_LIMITS, createCompiler, createCompilerRegistry } from '@refral/compiler';
import { createRemoteHost } from './remote-host';
import type { WaitMode } from './remote-host';
import type { ReadbackSample } from './protocol';
import { probeTimer } from './primitives';

const vertexSource = 'attribute vec2 a_position; void main(){gl_Position=vec4(a_position,0.,1.);}';
const fragmentSource = 'precision mediump float; uniform vec4 u_color; void main(){gl_FragColor=u_color;}';

export async function createScene(kind: CoreKind, mode: WaitMode) {
  const started = performance.now();
  const remote = await createRemoteHost(mode);
  let ownedCompiler: CompilerRegistry | undefined;
  let ownedResources: ExecutionResources | undefined;
  let ownedCore: DrawingCore | undefined;
  async function dispose() {
    ownedCore?.dispose();
    ownedResources?.dispose();
    ownedCompiler?.dispose();
    await remote.dispose();
  }
  try {
    const surface = { width: 64, height: 64 };
    const compiler = (ownedCompiler = createCompilerRegistry(await createCompiler()));
    const contextId = allocateContextId();
    const resources = (ownedResources = new ExecutionResources(contextId, remote.host));
    const options = {
      contextId,
      maxBufferBytes: remote.host.limits.maxBufferSize!,
      surface,
      attributes: { alpha: false, depth: true },
      profile: COMPILER_LIMITS,
    };
    const services = { compiler, host: remote.host, resources };
    const core = (ownedCore =
      kind === 'rust' ? await createRustDrawingCore(options, services) : createJsDrawingCore(options, services));
    const call = (operation: string, args: unknown[] = []) => core.invoke(operation, args);
    const vertex = call('createShader', [GL.VERTEX_SHADER]) as ShaderHandle;
    const fragment = call('createShader', [GL.FRAGMENT_SHADER]) as ShaderHandle;
    for (const [shader, source] of [
      [vertex, vertexSource],
      [fragment, fragmentSource],
    ] as const) {
      call('shaderSource', [shader, source]);
      call('compileShader', [shader]);
      if (!call('getShaderParameter', [shader, GL.COMPILE_STATUS]))
        throw new Error(String(call('getShaderInfoLog', [shader])));
    }
    const program = call('createProgram') as ProgramHandle;
    call('attachShader', [program, vertex]);
    call('attachShader', [program, fragment]);
    call('linkProgram', [program]);
    if (!call('getProgramParameter', [program, GL.LINK_STATUS]))
      throw new Error(String(call('getProgramInfoLog', [program])));
    call('useProgram', [program]);
    const buffer = core.createBuffer();
    core.bindBuffer(GL.ARRAY_BUFFER, buffer);
    core.bufferData(
      GL.ARRAY_BUFFER,
      new Uint8Array(new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]).buffer),
      GL.STATIC_DRAW
    );
    const attribute = call('getAttribLocation', [program, 'a_position']) as number;
    call('enableVertexAttribArray', [attribute]);
    call('vertexAttribPointer', [attribute, 2, GL.FLOAT, false, 0, 0]);
    const uniform = call('getUniformLocation', [program, 'u_color']) as UniformLocationHandle;
    const texture = call('createTexture') as TextureHandle;
    call('bindTexture', [GL.TEXTURE_2D, texture]);
    const framebuffer = call('createFramebuffer') as FramebufferHandle;
    call('bindFramebuffer', [GL.FRAMEBUFFER, framebuffer]);
    call('framebufferTexture2D', [GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, texture, 0]);
    call('bindFramebuffer', [GL.FRAMEBUFFER, null]);
    if (core.getError()) throw new Error('Scene initialization produced a GL error.');
    const initializationMs = performance.now() - started;
    let firstResult: Uint8Array | undefined;
    let firstPixel: number[] = [];

    function frame(index: number, width: number, height: number, offscreen: boolean): ReadbackSample {
      const frameStarted = performance.now();
      surface.width = width;
      surface.height = height;
      remote.resize(width, height);
      call('bindFramebuffer', [GL.FRAMEBUFFER, offscreen ? framebuffer : null]);
      if (offscreen) {
        call('texImage2D', [GL.TEXTURE_2D, 0, GL.RGBA, width, height, 0, GL.RGBA, GL.UNSIGNED_BYTE, null]);
        if (call('checkFramebufferStatus', [GL.FRAMEBUFFER]) !== GL.FRAMEBUFFER_COMPLETE)
          throw new Error('Incomplete experimental FBO.');
      }
      call('disable', [GL.SCISSOR_TEST]);
      call('clearColor', [0, 0, 0, 1]);
      call('clear', [GL.COLOR_BUFFER_BIT]);
      const left = index % 2 ? [0, 1, 0, 1] : [1, 0, 0, 1];
      const right = index % 2 ? [1, 0, 0, 1] : [0, 1, 0, 1];
      for (const [x, color] of [
        [0, left],
        [width / 2, right],
      ] as const) {
        call('viewport', [x, 0, width / 2, height]);
        call('uniform4fv', [uniform, new Float32Array(color)]);
        call('drawArrays', [GL.TRIANGLES, 0, 6]);
      }
      call('enable', [GL.SCISSOR_TEST]);
      call('scissor', [0, 0, width, 1]);
      call('clearColor', [0, index % 2, 1, 1]);
      call('clear', [GL.COLOR_BUFFER_BIT]);
      call('disable', [GL.SCISSOR_TEST]);
      const captureTarget = core.captureTarget();
      const clientEncodingMs = performance.now() - frameStarted;
      const captured = remote.capture(captureTarget);
      if (!(captured.data.buffer instanceof ArrayBuffer)) throw new Error('Readback result has shared ownership.');
      if (firstResult && firstPixel.some((value, index) => firstResult![index] !== value)) {
        throw new Error('A later command changed the retained readback result.');
      }
      if (!firstResult) {
        firstResult = captured.data;
        firstPixel = Array.from(firstResult.subarray(0, 4));
      }
      const query = call('getUniform', [program, uniform]) as Float32Array;
      if (core.getError() || query[0] !== right[0] || query[1] !== right[1])
        throw new Error('Local synchronous semantic query failed.');
      if (captured.width !== width || captured.height !== height || captured.data.byteLength !== width * height * 4) {
        throw new Error('Incorrect shared result dimensions.');
      }
      let mismatchedChannels = 0;
      let checksum = 2166136261;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const expected = y === 0 ? [0, index % 2, 1, 1] : x < width / 2 ? left : right;
          const offset = (y * width + x) * 4;
          for (let channel = 0; channel < 4; channel++) {
            const value = captured.data[offset + channel]!;
            if (value !== expected[channel]! * 255) mismatchedChannels++;
            checksum = Math.imul(checksum ^ value, 16777619) >>> 0;
          }
        }
      }
      return {
        sequence: captured.sequence,
        width,
        height,
        target: offscreen ? 'fbo' : 'default',
        byteLength: captured.data.byteLength,
        roundTripMs: captured.roundTripMs,
        clientEncodingMs,
        frameAndReadbackMs: clientEncodingMs + captured.roundTripMs,
        workerExecutionMs: captured.workerExecutionMs,
        workerCaptureMs: captured.workerCaptureMs,
        mismatchedChannels,
        checksum,
      };
    }

    return {
      selectedCore: core.kind,
      environment: remote.environment,
      initializationMs,
      frame,
      injectFailure: remote.injectFailure,
      timeout: remote.timeout,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export async function runSequence(kind: CoreKind, mode: WaitMode, observe?: (phase: 'start' | 'end') => void) {
  const timerResolution = probeTimer();
  const scene = await createScene(kind, mode);
  let timerRan = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    observe?.('start');
    timer = setTimeout(() => {
      timerRan = true;
    }, 0);
    const synchronousStarted = performance.now();
    const samples: ReadbackSample[] = [];
    for (const [width, height] of [
      [64, 64],
      [320, 240],
    ] as const) {
      for (const offscreen of [false, true]) {
        for (let frame = 0; frame < 8; frame++) samples.push(scene.frame(frame, width, height, offscreen));
      }
    }
    let failure = '';
    try {
      scene.injectFailure();
    } catch (error) {
      failure = String(error);
    }
    const recovered = scene.frame(8, 64, 64, true);
    let timeout = '';
    try {
      scene.timeout();
    } catch (error) {
      timeout = String(error);
    }
    observe?.('end');
    return {
      selectedCore: scene.selectedCore,
      environment: scene.environment,
      initializationMs: scene.initializationMs,
      timerResolution,
      samples,
      failure,
      recovered,
      timeout,
      synchronousSequenceMs: performance.now() - synchronousStarted,
      sameAgentTimerRanDuringCalls: timerRan,
      timingBoundary:
        'Synchronous capture round trip includes posting queued host operations, worker execution, GPU completion/map, shared copy and client-owned result copy. Client encoding is measured separately before the capture call.',
    };
  } finally {
    clearTimeout(timer);
    await scene.dispose();
  }
}

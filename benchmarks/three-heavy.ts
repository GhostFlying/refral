// The BufferGeometry and Sobel scenes adapt Three.js r162 examples.
// Copyright 2010-2024 three.js authors. See examples/three-shapes/LICENSE.
import {
  AmbientLight, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide,
  Fog, Mesh, MeshPhongMaterial, PerspectiveCamera, PointLight, Scene, TextureLoader,
  TorusKnotGeometry, UnsignedByteType, Vector3, WebGL1Renderer, WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { LuminosityShader } from 'three/addons/shaders/LuminosityShader.js';
import { SobelOperatorShader } from 'three/addons/shaders/SobelOperatorShader.js';
import { createThreeContext } from '../examples/three-context';
import type { ThreeBackend } from '../examples/three-context';
import { interactiveCubes, suzanneMeshes } from './three-large';
import { createShapesScene } from '../examples/three-shapes/scene';

export const heavyScenes = {
  'suzanne-1000': { width: 1280, height: 720 },
  'suzanne-3000': { width: 1280, height: 720 },
  'interactive-cubes': { width: 1280, height: 720 },
  'shapes-four': { width: 1600, height: 1200 },
  'triangle-cloud': { width: 1280, height: 720 },
  'sobel-1080p': { width: 1920, height: 1080 },
  'sobel-540p': { width: 960, height: 540 },
} as const;
export type HeavyScene = keyof typeof heavyScenes;

interface SceneWork {
  render(seconds: number): void;
  dispose(): void;
}

async function shapesViews(renderer: WebGL1Renderer, width: number, height: number): Promise<SceneWork> {
  const grid = new URL('../examples/three-shapes/uv_grid_opengl.jpg', import.meta.url);
  const texture = await new TextureLoader().loadAsync(grid.href);
  const { scene, camera, group } = createShapesScene(texture, width / height);
  const viewWidth = width / 2;
  const viewHeight = height / 2;
  renderer.setScissorTest(true);
  return {
    render(seconds) {
      for (let view = 0; view < 4; view++) {
        const x = (view % 2) * viewWidth;
        const y = Math.floor(view / 2) * viewHeight;
        renderer.setViewport(x, y, viewWidth, viewHeight);
        renderer.setScissor(x, y, viewWidth, viewHeight);
        group.rotation.y = 0.18 + Math.sin(seconds * 2.4 + view * 1.5) * 0.32;
        renderer.render(scene, camera);
      }
    },
    dispose() { texture.dispose(); },
  };
}

function triangleCloud(renderer: WebGL1Renderer, aspect: number): SceneWork {
  const scene = new Scene();
  const camera = new PerspectiveCamera(27, aspect, 1, 3500);
  camera.position.z = 2750;
  scene.background = new Color(0x050505);
  scene.fog = new Fog(0x050505, 2000, 3500);
  scene.add(new AmbientLight(0xcccccc));
  const key = new DirectionalLight(0xffffff, 1.5);
  key.position.set(1, 1, 1);
  const fill = new DirectionalLight(0xffffff, 4.5);
  fill.position.set(0, -1, 0);
  scene.add(key, fill);

  const triangles = 160_000;
  const positions = new Float32Array(triangles * 9);
  const normals = new Float32Array(triangles * 9);
  const colors = new Float32Array(triangles * 12);
  let seed = 47;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  }
  const center = new Vector3();
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const normal = new Vector3(), edge = new Vector3();
  function jitter(vertex: Vector3) {
    vertex.set(center.x + random() * 12 - 6, center.y + random() * 12 - 6, center.z + random() * 12 - 6);
  }
  for (let triangle = 0; triangle < triangles; triangle++) {
    center.set(random() * 800 - 400, random() * 800 - 400, random() * 800 - 400);
    jitter(a);
    jitter(b);
    jitter(c);
    normal.subVectors(c, b).cross(edge.subVectors(a, b)).normalize();
    const alpha = random();
    const start = triangle * 9;
    a.toArray(positions, start);
    b.toArray(positions, start + 3);
    c.toArray(positions, start + 6);
    for (let vertex = 0; vertex < 3; vertex++) {
      normal.toArray(normals, start + vertex * 3);
      const index = triangle * 12 + vertex * 4;
      colors[index] = center.x / 800 + 0.5;
      colors[index + 1] = center.y / 800 + 0.5;
      colors[index + 2] = center.z / 800 + 0.5;
      colors[index + 3] = alpha;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 4));
  const material = new MeshPhongMaterial({
    color: 0xd5d5d5, specular: 0xffffff, shininess: 250,
    side: DoubleSide, vertexColors: true, transparent: true,
  });
  const mesh = new Mesh(geometry, material);
  scene.add(mesh);
  return {
    render(seconds) {
      mesh.rotation.set(seconds * 0.25, seconds * 0.5, 0);
      renderer.render(scene, camera);
    },
    dispose() {
      material.dispose();
      geometry.dispose();
    },
  };
}

function sobelWork(renderer: WebGL1Renderer, width: number, height: number): SceneWork {
  const scene = new Scene();
  const camera = new PerspectiveCamera(70, width / height, 0.1, 100);
  camera.position.set(0, 1, 3);
  camera.lookAt(scene.position);
  camera.add(new PointLight(0xffffff, 20));
  scene.add(camera, new AmbientLight(0xe7e7e7));
  const geometry = new TorusKnotGeometry(1, 0.3, 256, 32);
  const material = new MeshPhongMaterial({ color: 0xffff00 });
  const mesh = new Mesh(geometry, material);
  scene.add(mesh);

  const target = new WebGLRenderTarget(width, height, { type: UnsignedByteType });
  const composer = new EffectComposer(renderer, target);
  const scenePass = new RenderPass(scene, camera);
  const luminosity = new ShaderPass(LuminosityShader);
  const sobel = new ShaderPass(SobelOperatorShader);
  sobel.uniforms.resolution!.value.set(width, height);
  composer.addPass(scenePass);
  composer.addPass(luminosity);
  composer.addPass(sobel);
  return {
    render(seconds) {
      mesh.rotation.set(seconds * 0.4, seconds * 0.7, 0);
      composer.render(1 / 60);
    },
    dispose() {
      scenePass.dispose();
      luminosity.dispose();
      sobel.dispose();
      composer.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}

export async function runHeavyScene(name: HeavyScene, backend: ThreeBackend, warmup: number, samples: number) {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  document.body.style.margin = '0';
  document.body.replaceChildren(canvas);
  const { width, height } = heavyScenes[name];
  const started = performance.now();
  const { gl, attributes, hooks } = await createThreeContext(canvas, backend, { width, height });
  const contextMs = performance.now() - started;
  const sceneStarted = performance.now();
  const renderer = new WebGL1Renderer({ canvas, context: gl, ...attributes });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.info.autoReset = false;
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    const messages = [context.getProgramInfoLog(program), context.getShaderInfoLog(vertex), context.getShaderInfoLog(fragment)];
    throw new Error(messages.filter(Boolean).join('\n') || 'Three.js shader compilation failed.');
  };
  let scene: SceneWork;
  switch (name) {
    case 'suzanne-1000': scene = await suzanneMeshes(renderer, width / height, 1000); break;
    case 'suzanne-3000': scene = await suzanneMeshes(renderer, width / height, 3000); break;
    case 'interactive-cubes': scene = interactiveCubes(renderer, width / height); break;
    case 'shapes-four': scene = await shapesViews(renderer, width, height); break;
    case 'triangle-cloud': scene = triangleCloud(renderer, width / height); break;
    default: scene = sobelWork(renderer, width, height);
  }
  const sceneMs = performance.now() - sceneStarted;
  window.addEventListener('pagehide', () => {
    scene.dispose();
    renderer.dispose();
    void hooks?.dispose();
  }, { once: true });

  const nextFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
  function step(index: number) {
    const seconds = index / 60;
    renderer.info.reset();
    const before = performance.now();
    scene.render(seconds);
    gl.flush();
    const cpuMs = performance.now() - before;
    const { calls, triangles, points, lines } = renderer.info.render;
    return { seconds, cpuMs, calls, triangles, points, lines };
  }

  await nextFrame();
  const first = step(0);
  const firstStats = hooks ? { ...hooks.stats } : null;
  const firstImage = await createImageBitmap(canvas);
  const firstImageMs = performance.now() - started;
  if (firstImage.width !== width || firstImage.height !== height) throw new Error('First image has the wrong size.');
  firstImage.close();
  for (let frame = 0; frame < warmup; frame++) {
    await nextFrame();
    step(frame + 1);
  }

  const beforeStats = hooks ? { ...hooks.stats } : null;
  const beforeBatchStats = hooks?.rustCommandBatchStats() ?? null;
  const frames = [];
  let previous = await nextFrame();
  for (let frame = 0; frame < samples; frame++) {
    const sample = step(warmup + frame + 1);
    const next = await nextFrame();
    frames.push({ ...sample, intervalMs: next - previous });
    previous = next;
  }
  const afterStats = hooks ? { ...hooks.stats } : null;
  const afterBatchStats = hooks?.rustCommandBatchStats() ?? null;
  // Repeat the last pose to produce a comparable screenshot outside sampling.
  step(warmup + samples);
  await hooks?.device.queue.onSubmittedWorkDone();
  let timerResolutionMs = Infinity;
  let lastTime = performance.now();
  for (let sample = 0; sample < 5000; sample++) {
    const current = performance.now();
    if (current > lastTime) timerResolutionMs = Math.min(timerResolutionMs, current - lastTime);
    lastTime = current;
  }
  const debug = backend === 'native' ? gl.getExtension('WEBGL_debug_renderer_info') : null;
  const adapter = hooks?.environment.adapter ?? {
    renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
    vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR),
  };
  return {
    selectedCore: hooks?.core ?? 'native', width, height, devicePixelRatio, crossOriginIsolated, adapter,
    timerResolutionMs: Number.isFinite(timerResolutionMs) ? timerResolutionMs : null,
    gpuTimingFeature: hooks ? hooks.device.features.has('timestamp-query')
      : gl.getSupportedExtensions()?.includes('EXT_disjoint_timer_query') ?? false,
    attributes: gl.getContextAttributes(), frames, first, contextMs, sceneMs, firstImageMs,
    firstStats, beforeStats, afterStats, glError: gl.getError(), gpuErrors: hooks?.errors.slice() ?? [],
    beforeBatchStats, afterBatchStats,
  };
}

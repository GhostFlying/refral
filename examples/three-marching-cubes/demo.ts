// Adapted from three.js r162 examples/webgl_marchingcubes.html.
// Copyright 2010-2024 three.js authors. See ../three-shapes/LICENSE.
import { AmbientLight, BufferAttribute, Color, DirectionalLight, MeshPhongMaterial, PerspectiveCamera, PointLight,
  Scene, WebGL1Renderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { createThreeContext } from '../three-context';
import type { ThreeBackend } from '../three-context';

export const marchingCubesWorkload = { resolution: 48, blobs: 16, triangleCapacity: 32768 };
const palette = [0xff0000, 0xffbb00, 0xffff00, 0x00ff00, 0x0000ff, 0x9400bd, 0xc800eb].map(value => new Color(value));
const updatedAttributes = ['position', 'normal', 'color'];

export async function createMarchingCubesDemo(canvas: HTMLCanvasElement, backend: ThreeBackend) {
  const { gl, attributes, hooks } = await createThreeContext(canvas, backend);
  try {
    const scene = new Scene();
    scene.background = new Color(0x050505);
    const camera = new PerspectiveCamera(45, canvas.width / canvas.height, 1, 10000);
    camera.position.set(-500, 500, 1500);
    const light = new DirectionalLight(0xffffff, 3);
    light.position.set(0.5, 0.5, 1);
    const pointLight = new PointLight(0xff7c00, 3, 0, 0);
    pointLight.position.set(0, 0, 100);
    scene.add(light, pointLight, new AmbientLight(0x323232, 3));

    const material = new MeshPhongMaterial({ shininess: 2, vertexColors: true });
    const { resolution, blobs, triangleCapacity } = marchingCubesWorkload;
    const surface = new MarchingCubes(resolution, material, false, true, triangleCapacity);
    const streams = updatedAttributes.map(name => {
      const attribute = surface.geometry.getAttribute(name);
      if (!(attribute instanceof BufferAttribute)) throw new Error(`Missing Marching Cubes ${name} buffer.`);
      return attribute;
    });
    surface.scale.setScalar(700);
    surface.isolation = 80;
    scene.add(surface);

    const renderer = new WebGL1Renderer({ canvas, context: gl, ...attributes });
    renderer.setPixelRatio(1);
    renderer.setSize(canvas.width, canvas.height, false);
    renderer.debug.onShaderError = (context, program, vertex, fragment) => {
      const log = [context.getProgramInfoLog(program), context.getShaderInfoLog(vertex), context.getShaderInfoLog(fragment)]
        .filter(Boolean).join('\n');
      throw new Error(log || 'Three.js shader compilation failed.');
    };
    const controls = new OrbitControls(camera, canvas);
    controls.minDistance = 500;
    controls.maxDistance = 5000;
    controls.update();
    const strength = 1.2 / ((Math.sqrt(blobs) - 1) / 4 + 1);

    return {
      backend: hooks?.core ?? 'native', gl, hooks, renderer,
      render(seconds: number) {
        const time = seconds * 0.5;
        surface.reset();
        for (let i = 0; i < blobs; i++) {
          const x = Math.sin(i + 1.26 * time * (1.03 + 0.5 * Math.cos(0.21 * i))) * 0.27 + 0.5;
          const y = Math.abs(Math.cos(i + 1.12 * time * Math.cos(1.22 + 0.1424 * i))) * 0.77;
          const z = Math.cos(i + 1.32 * time * 0.1 * Math.sin(0.92 + 0.53 * i)) * 0.27 + 0.5;
          surface.addBall(x, y, z, strength, 12, palette[i % palette.length]);
        }
        surface.addPlaneY(2, 12);
        surface.update();
        for (const attribute of streams) {
          attribute.clearUpdateRanges();
          attribute.addUpdateRange(0, surface.count * attribute.itemSize);
        }
        controls.update();
        renderer.render(scene, camera);
      },
      async dispose() {
        controls.dispose();
        surface.geometry.dispose();
        material.dispose();
        renderer.dispose();
        await hooks?.dispose();
      },
    };
  } catch (error) {
    await hooks?.dispose();
    throw error;
  }
}

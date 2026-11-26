// Adapted from Three.js r162 examples. See THIRD_PARTY.md and examples/three-shapes/LICENSE.
import {
  BoxGeometry, BufferGeometryLoader, Color, DirectionalLight, MeshLambertMaterial,
  Mesh, MeshNormalMaterial, PerspectiveCamera, Raycaster, Scene, Vector2, WebGL1Renderer,
} from 'three';

const suzanneUrl = '/artifacts/three-scene-assets/suzanne_buffergeometry.json';

function seededRandom() {
  let state = 47;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export async function suzanneMeshes(renderer: WebGL1Renderer, aspect: number, count: number) {
  const geometry = await new BufferGeometryLoader().loadAsync(suzanneUrl);
  geometry.computeVertexNormals();
  const material = new MeshNormalMaterial();
  const scene = new Scene();
  scene.background = new Color(0xffffff);
  const camera = new PerspectiveCamera(70, aspect, 1, 100);
  const random = seededRandom();
  for (let i = 0; i < count; i++) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(random() * 40 - 20, random() * 40 - 20, random() * 40 - 20);
    const u = random();
    const theta = 2 * Math.PI * random();
    const phi = 2 * Math.PI * random();
    mesh.quaternion.set(Math.sqrt(1 - u) * Math.sin(theta), Math.sqrt(1 - u) * Math.cos(theta),
      Math.sqrt(u) * Math.sin(phi), Math.sqrt(u) * Math.cos(phi));
    mesh.scale.setScalar(random());
    scene.add(mesh);
  }
  return {
    render(seconds: number) {
      const angle = seconds * Math.PI / 15;
      camera.position.set(30 * Math.sin(angle), 0, 30 * Math.cos(angle));
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

export function interactiveCubes(renderer: WebGL1Renderer, aspect: number) {
  const scene = new Scene();
  scene.background = new Color(0xf0f0f0);
  const light = new DirectionalLight(0xffffff, 3);
  light.position.set(1, 1, 1).normalize();
  scene.add(light);
  const camera = new PerspectiveCamera(70, aspect, 0.1, 100);
  const geometry = new BoxGeometry();
  const cubes: Mesh<BoxGeometry, MeshLambertMaterial>[] = [];
  const random = seededRandom();
  for (let i = 0; i < 2_000; i++) {
    const cube = new Mesh(geometry, new MeshLambertMaterial({ color: random() * 0xffffff }));
    cube.position.set(random() * 40 - 20, random() * 40 - 20, random() * 40 - 20);
    cube.rotation.set(random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2);
    cube.scale.set(random() + 0.5, random() + 0.5, random() + 0.5);
    scene.add(cube);
    cubes.push(cube);
  }
  const raycaster = new Raycaster();
  const pointer = new Vector2(0, 0);
  let highlighted: Mesh<BoxGeometry, MeshLambertMaterial> | undefined;
  return {
    render(seconds: number) {
      const angle = seconds * Math.PI / 30;
      // Frame the full field so the material-change workload stays near 2,000 draws.
      camera.position.set(50 * Math.sin(angle), 50 * Math.sin(angle), 50 * Math.cos(angle));
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      raycaster.setFromCamera(pointer, camera);
      const next = raycaster.intersectObjects<Mesh<BoxGeometry, MeshLambertMaterial>>(cubes, false)[0]?.object;
      if (next !== highlighted) {
        highlighted?.material.emissive.setHex(0);
        next?.material.emissive.setHex(0xff0000);
        highlighted = next;
      }
      renderer.render(scene, camera);
    },
    dispose() {
      geometry.dispose();
      for (const cube of cubes) cube.material.dispose();
    },
  };
}

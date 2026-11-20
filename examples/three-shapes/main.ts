import { createShapesDemo, shapesBackends } from './demo';
import type { ShapesBackend } from './demo';

const requested = new URLSearchParams(location.search).get('core');
const backend = shapesBackends.find(value => value === requested) ?? 'native';
document.querySelector(`a[href="?core=${backend}"]`)?.setAttribute('aria-current', 'page');
const canvas = document.querySelector('canvas')!;
const status = document.querySelector('output')!;
status.value = 'Loading Three.js Shapes…';

async function start(core: ShapesBackend) {
  const demo = await createShapesDemo(canvas, core);
  let rotation = 0.18;
  let targetRotation = rotation;
  let pointer: { id: number; x: number; angle: number } | undefined;
  canvas.addEventListener('pointerdown', event => {
    if (!event.isPrimary) return;
    pointer = { id: event.pointerId, x: event.clientX, angle: targetRotation };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (pointer?.id === event.pointerId) targetRotation = pointer.angle + (event.clientX - pointer.x) * 0.02;
  });
  canvas.addEventListener('lostpointercapture', () => { pointer = undefined; });
  demo.render(rotation);
  status.value = `${demo.renderer.info.render.calls} draw calls · Drag to rotate`;
  let frame: number;
  function animate() {
    if (Math.abs(targetRotation - rotation) > 0.0001) {
      rotation += (targetRotation - rotation) * 0.05;
      demo.render(rotation);
    }
    frame = requestAnimationFrame(animate);
  }
  frame = requestAnimationFrame(animate);
  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(frame);
    void demo.dispose();
  }, { once: true });
}

void start(backend).catch(error => { status.value = String(error); });

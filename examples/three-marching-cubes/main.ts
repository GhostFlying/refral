import { threeBackends } from '../three-context';
import { createMarchingCubesDemo } from './demo';

const requested = new URLSearchParams(location.search).get('core');
const backend = threeBackends.find(value => value === requested) ?? 'native';
document.querySelector(`a[href="?core=${backend}"]`)?.setAttribute('aria-current', 'page');
const canvas = document.querySelector('canvas')!;
const status = document.querySelector('output')!;

async function start() {
  const demo = await createMarchingCubesDemo(canvas, backend);
  let frame: number;
  let startTime: number | undefined;
  let lastStatus: number | undefined;
  const format = new Intl.NumberFormat(document.documentElement.lang);
  function animate(timestamp: number) {
    startTime ??= timestamp;
    try {
      demo.render((timestamp - startTime) / 1000);
      if (lastStatus === undefined || timestamp - lastStatus >= 250) {
        status.value = `Playing · ${format.format(demo.renderer.info.render.triangles)} triangles · Drag to orbit`;
        lastStatus = timestamp;
      }
      frame = requestAnimationFrame(animate);
    } catch (error) {
      status.value = String(error);
      void demo.dispose();
    }
  }
  frame = requestAnimationFrame(animate);
  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(frame);
    void demo.dispose();
  }, { once: true });
}

void start().catch(error => { status.value = String(error); });

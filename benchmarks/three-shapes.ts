import { createShapesDemo } from '../examples/three-shapes/demo';
import type { ShapesBackend } from '../examples/three-shapes/demo';

export const shapesSampling = { warmup: 30, samples: 120 };
const rotation = (frame: number) => 0.18 + Math.sin(frame * 0.075) * 0.32;
const nextFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));

export async function runShapesBenchmark(backend: ShapesBackend) {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  document.body.replaceChildren(canvas);
  const demo = await createShapesDemo(canvas, backend);
  const render = (angle: number) => {
    const started = performance.now();
    demo.render(angle);
    demo.gl.flush();
    return performance.now() - started;
  };
  try {
    await nextFrame();
    const firstFrameCpuMs = render(rotation(0));
    for (let frame = 0; frame < shapesSampling.warmup; frame++) {
      await nextFrame();
      render(rotation(frame));
    }
    const initialStats = demo.hooks ? { ...demo.hooks.stats } : null;
    const frames = [];
    let timestamp = await nextFrame();
    const started = timestamp;
    for (let frame = 0; frame < shapesSampling.samples; frame++) {
      const cpuMs = render(rotation(frame));
      const { calls, triangles, lines, points } = demo.renderer.info.render;
      const next = await nextFrame();
      frames.push({ cpuMs, rafIntervalMs: next - timestamp, calls, triangles, lines, points });
      timestamp = next;
    }
    const endStats = demo.hooks ? { ...demo.hooks.stats } : null;
    render(0.18);
    await nextFrame();
    return {
      backend: demo.backend, environment: demo.environment, contextAttributes: demo.gl.getContextAttributes(),
      timer: { crossOriginIsolated, devicePixelRatio }, contextMs: demo.contextMs, sceneMs: demo.sceneMs,
      firstFrameCpuMs, rafElapsedMs: timestamp - started, frames, initialStats, endStats,
      glError: demo.gl.getError(), gpuErrors: demo.hooks?.errors.slice() ?? [],
    };
  } finally {
    // Keep the final frame displayed for Playwright's screenshot.
    window.addEventListener('pagehide', () => { void demo.dispose(); }, { once: true });
  }
}

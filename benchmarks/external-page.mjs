export async function installExternalPage({ backend, unity }) {
  const api = await import('/packages/webgl/src/index.ts');
  const factory = backend === 'native' ? null : await api.prepareContextFactory({ core: backend });
  const acquire = HTMLCanvasElement.prototype.getContext;
  const contexts = new Map();
  HTMLCanvasElement.prototype.getContext = function(kind, attributes) {
    if (kind === 'webgl2') return null;
    if (kind !== 'webgl' && kind !== 'experimental-webgl') return acquire.call(this, kind, attributes);
    if (contexts.has(this)) return contexts.get(this);
    const requested = { ...attributes, antialias: false };
    const context = factory ? factory(this, requested) : acquire.call(this, kind, requested);
    if (context) contexts.set(this, context);
    return context;
  };
  const raf = requestAnimationFrame.bind(window);
  const callbacks = new Map();
  let sequence = 0;
  let tick = 0;
  const frameTime = () => 100000 + tick * (1000 / 60);
  if (!unity) {
    const OriginalDate = Date;
    window.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [frameTime()])); }
      static now() { return frameTime(); }
    };
    let seed = 123456;
    Math.random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    window.requestAnimationFrame = callback => {
      callbacks.set(++sequence, callback);
      return sequence;
    };
    window.cancelAnimationFrame = id => callbacks.delete(id);
  }
  window.externalBench = {
    ready: () => contexts.size > 0 && callbacks.size > 0,
    contexts: () => [...contexts.values()].map(gl => factory ? api.getTestingHooks(gl).core : 'native'),
    async run(warmup, samples) {
      const canvas = [...contexts.keys()].find(canvas => canvas.isConnected);
      const gl = contexts.get(canvas);
      if (!gl) throw new Error('Missing live benchmark context');
      const hooks = factory ? api.getTestingHooks(gl) : null;
      if (hooks && hooks.core !== backend) throw new Error('Wrong selected core');
      const cpu = [], intervals = [];
      let previousTimestamp;
      let before;
      for (let index = 0; index < warmup + samples; index++) {
        const timestamp = await new Promise(resolve => raf(resolve));
        const scheduled = [...callbacks.values()];
        if (!scheduled.length) throw new Error('Animation stopped');
        callbacks.clear();
        tick++;
        if (index === warmup) before = { ...hooks?.stats };
        const start = performance.now();
        for (const callback of scheduled) callback(frameTime());
        gl.flush();
        const elapsed = performance.now() - start;
        if (index >= warmup) {
          cpu.push(elapsed);
          intervals.push(timestamp - previousTimestamp);
        }
        previousTimestamp = timestamp;
      }
      await hooks?.device.queue.onSubmittedWorkDone();
      const after = { ...hooks?.stats };
      // Audit the next deterministic frame after stopping both clocks.
      let auditDraws = 0;
      for (const name of ['drawArrays', 'drawElements']) {
        const original = gl[name];
        gl[name] = function(...args) {
          auditDraws++;
          return original.apply(this, args);
        };
      }
      const scheduled = [...callbacks.values()];
      callbacks.clear();
      tick++;
      for (const callback of scheduled) callback(frameTime());
      gl.flush();
      await hooks?.device.queue.onSubmittedWorkDone();
      const debug = !factory && gl.getExtension('WEBGL_debug_renderer_info');
      const timerStart = performance.now();
      let now;
      do { now = performance.now(); } while (now === timerStart);
      return { cpu, intervals, auditDraws, timerStep: now - timerStart,
        before, after, core: hooks?.core ?? 'native',
        adapter: hooks?.environment.adapter ?? gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
        attributes: gl.getContextAttributes(), width: gl.drawingBufferWidth, height: gl.drawingBufferHeight,
        errors: hooks?.errors.slice() ?? [], glError: gl.getError() };
    },
  };
}

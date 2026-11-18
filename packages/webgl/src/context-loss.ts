type Phase = 'active' | 'dispatching' | 'restorable' | 'restoring' | 'permanent' | 'disposed';

export function createContextLoss(canvas: EventTarget, generation: {
  lose(): boolean; restore(): Promise<boolean>; invalidOperation(): void;
}) {
  let phase: Phase = 'active';
  let deviceLost = false;

  function lose(simulated: boolean, statusMessage: string) {
    if (!simulated) deviceLost = true;
    if (phase !== 'active' || !generation.lose()) {
      if (simulated && phase !== 'disposed') generation.invalidOperation();
      return;
    }
    phase = 'dispatching';
    setTimeout(() => {
      if (phase !== 'dispatching') return;
      const event = new WebGLContextEvent('webglcontextlost', { cancelable: true, statusMessage });
      canvas.dispatchEvent(event);
      if (phase === 'dispatching') phase = simulated && !deviceLost && event.defaultPrevented ? 'restorable' : 'permanent';
    }, 0);
  }

  const extension: WEBGL_lose_context = {
    loseContext() {
      if (this !== extension) throw new TypeError('Expected a WEBGL_lose_context receiver.');
      lose(true, '');
    },
    restoreContext() {
      if (this !== extension) throw new TypeError('Expected a WEBGL_lose_context receiver.');
      if (phase === 'restoring' && !deviceLost) return;
      if (phase !== 'restorable' || deviceLost) { generation.invalidOperation(); return; }
      phase = 'restoring';
      setTimeout(async () => {
        if (phase !== 'restoring' || deviceLost) return;
        const restored = await generation.restore();
        if (phase !== 'restoring' || deviceLost) return;
        if (!restored) { phase = 'restorable'; return; }
        phase = 'active';
        canvas.dispatchEvent(new WebGLContextEvent('webglcontextrestored'));
      }, 0);
    },
  };

  return {
    extension,
    deviceLoss(message: string) { lose(false, message); },
    dispose() { phase = 'disposed'; },
    canRestore: () => phase === 'restoring' && !deviceLost,
  };
}

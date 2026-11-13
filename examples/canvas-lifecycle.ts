const cleanups = new WeakMap<HTMLCanvasElement, () => void | Promise<void>>();

export function registerCanvasCleanup(canvas: HTMLCanvasElement, cleanup: () => void | Promise<void>) {
  cleanups.set(canvas, cleanup);
}

export async function replaceCanvas(id: string): Promise<HTMLCanvasElement> {
  const current = document.getElementById(id) as HTMLCanvasElement;
  await cleanups.get(current)?.();
  cleanups.delete(current);
  const next = current.cloneNode(false) as HTMLCanvasElement;
  current.replaceWith(next);
  return next;
}

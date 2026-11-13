import { runProbe } from './probe';
import { replaceCanvas } from './canvas-lifecycle';

const status = document.querySelector<HTMLOutputElement>('#status')!;
const report = document.querySelector<HTMLPreElement>('#report')!;

async function execute(action: () => Promise<unknown>) {
  status.textContent = 'Running';
  try {
    const result = await action();
    report.textContent = JSON.stringify(result, null, 2);
    status.textContent = 'Passed';
  } catch (error) {
    status.textContent = 'Failed';
    report.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(error);
  }
}

document.querySelector<HTMLButtonElement>('#probe')!.addEventListener('click', () => {
  void execute(async () => {
    const canvas = await replaceCanvas('gpu');
    const nativeCanvas = await replaceCanvas('native');
    return runProbe(canvas, nativeCanvas);
  });
});

document.querySelector<HTMLButtonElement>('#demo')!.addEventListener('click', () => {
  void execute(async () => {
    const { runDemo } = await import('./render-to-texture');
    const backend = document.querySelector<HTMLSelectElement>('#backend')!.value as 'native' | 'refral';
    const canvas = await replaceCanvas('gpu');
    const nativeCanvas = await replaceCanvas('native');
    const nativeReference = await runDemo(nativeCanvas, 'native');
    const selected = await runDemo(canvas, backend);
    return { ...selected, nativeReference };
  });
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GL } from '@refral/core-api';
import { createContextLoss } from './context-loss';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebGLContextEvent', class extends Event {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  const canvas = new EventTarget();
  let lost = false;
  const errors = new Set<number>();
  const restore = vi.fn(async () => { lost = false; return true; });
  const controller = createContextLoss(canvas, {
    lose() { if (lost) return false; lost = true; errors.clear(); errors.add(GL.CONTEXT_LOST_WEBGL); return true; },
    restore,
    invalidOperation() { errors.add(GL.INVALID_OPERATION); },
  });
  function getError() { const value = [...errors][0] ?? GL.NO_ERROR; errors.delete(value); return value; }
  return { canvas, controller, restore, getError };
}

it('requires completion and cancellation of the loss event before asynchronous restoration', async () => {
  const { canvas, controller, restore, getError } = setup();
  const extension = controller.extension;
  const order: string[] = [];
  canvas.addEventListener('webglcontextlost', event => {
    order.push('lost');
    event.preventDefault();
    extension.restoreContext();
    expect(getError()).toBe(GL.INVALID_OPERATION);
  });
  canvas.addEventListener('webglcontextrestored', () => order.push('restored'));
  extension.loseContext();
  extension.loseContext();
  expect(order).toEqual([]);
  expect([getError(), getError(), getError()]).toEqual([
    GL.CONTEXT_LOST_WEBGL, GL.INVALID_OPERATION, GL.NO_ERROR]);
  await vi.runAllTimersAsync();
  extension.restoreContext();
  extension.restoreContext();
  expect(restore).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  expect(restore).toHaveBeenCalledTimes(1);
  expect(order).toEqual(['lost', 'restored']);
  extension.restoreContext();
  expect(getError()).toBe(GL.INVALID_OPERATION);
});

it('keeps uncanceled and physical device losses ineligible for extension restoration', async () => {
  for (const physical of [false, true]) {
    const { canvas, controller, restore, getError } = setup();
    if (physical) {
      canvas.addEventListener('webglcontextlost', event => event.preventDefault());
      controller.deviceLoss('device removed');
    } else controller.extension.loseContext();
    await vi.runAllTimersAsync();
    controller.extension.restoreContext();
    await vi.runAllTimersAsync();
    expect(restore).not.toHaveBeenCalled();
    expect([getError(), getError()]).toEqual([GL.CONTEXT_LOST_WEBGL, GL.INVALID_OPERATION]);
  }
});

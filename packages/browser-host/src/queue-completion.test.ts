import { expect, it, vi } from 'vitest';
import { QueueCompletion } from './queue-completion.js';

it('observes each queued batch once and only certifies its captured work', async () => {
  const resolvers: (() => void)[] = [];
  const onSubmittedWorkDone = vi.fn(() => new Promise<undefined>(resolve => resolvers.push(() => resolve(undefined))));
  const work = new QueueCompletion({ onSubmittedWorkDone });
  expect(work.isIdle).toBe(true);
  await work.observe();
  expect(onSubmittedWorkDone).not.toHaveBeenCalled();

  work.markIssued();
  const earlier = work.observe();
  expect(work.observe()).toBe(earlier);
  work.markIssued();
  const later = work.observe();
  resolvers[0]!();
  await earlier;
  expect(work.isIdle).toBe(false);
  resolvers[1]!();
  await later;
  expect(work.isIdle).toBe(true);
  expect(onSubmittedWorkDone).toHaveBeenCalledTimes(2);
});

it('retains pending status after a failed fence and retries on the next observation', async () => {
  const onSubmittedWorkDone = vi.fn().mockRejectedValueOnce(new Error('queue lost')).mockResolvedValueOnce(undefined);
  const work = new QueueCompletion({ onSubmittedWorkDone });
  work.markIssued();
  await expect(work.observe()).rejects.toThrow('queue lost');
  expect(work.isIdle).toBe(false);
  await work.observe();
  expect(work.isIdle).toBe(true);
});

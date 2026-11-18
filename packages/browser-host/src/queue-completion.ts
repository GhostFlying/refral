/** Tracks this context's work even when several contexts share the device queue. */
export class QueueCompletion {
  private issued = 0;
  private observed = 0;
  private completed = 0;
  private fence = Promise.resolve();

  constructor(private readonly queue: Pick<GPUQueue, 'onSubmittedWorkDone'>) {}

  markIssued(): void {
    this.issued++;
  }

  get isIdle(): boolean {
    return this.completed === this.issued;
  }

  observe(): Promise<void> {
    if (this.observed === this.issued) return this.fence;
    const epoch = this.issued;
    this.observed = epoch;
    this.fence = this.queue.onSubmittedWorkDone().then(() => {
      this.completed = Math.max(this.completed, epoch);
    });
    // A rejected fence provides no completion proof. Allow a subsequent flush to retry.
    void this.fence.catch(() => {
      if (this.observed === epoch) this.observed = -1;
    });
    return this.fence;
  }
}

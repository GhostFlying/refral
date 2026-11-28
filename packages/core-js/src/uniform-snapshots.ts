const initialPageBytes = 4 * 1024;
const maxPageBytes = 64 * 1024;

// A queued draw owns its range. Pages are never rewound while a consumer
// might still hold a view, even across flush, context loss or disposal.
export class UniformSnapshots {
  private page: Uint8Array | null = null;
  private used = 0;

  copy(source: Uint8Array): Uint8Array {
    const size = source.byteLength;
    if (size > maxPageBytes || size === 0) return source.slice();
    if (!this.page || size > this.page.length - this.used) {
      const capacity = this.page ? Math.min(this.page.length * 4, maxPageBytes) : initialPageBytes;
      this.page = new Uint8Array(Math.max(size, capacity));
      this.used = 0;
    }
    const result = this.page.subarray(this.used, this.used + size);
    result.set(source);
    this.used += size;
    return result;
  }

  clear(): void {
    this.page = null;
    this.used = 0;
  }
}

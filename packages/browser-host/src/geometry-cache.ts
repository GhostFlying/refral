/** Retain immutable geometry for whole draw working sets under a per-context budget. */
export class GeometryCache {
  private readonly resident = new Map<string, GPUBuffer>();
  private readonly workingSet = new Map<string, GPUBuffer>();
  private residentBytes = 0;
  private newCount = 0;

  constructor(
    private readonly byteLimit: number,
    private readonly entryLimit: number,
    private readonly retain: (buffer: GPUBuffer) => void,
    private readonly retire: (buffer: GPUBuffer) => void,
  ) {}

  beginDraw(): void {
    this.workingSet.clear();
    this.newCount = 0;
  }

  get(key: string): GPUBuffer | undefined {
    const inDraw = this.workingSet.get(key);
    if (inDraw) return inDraw;
    const buffer = this.resident.get(key);
    if (buffer) {
      this.resident.delete(key);
      this.resident.set(key, buffer);
      this.workingSet.set(key, buffer);
    }
    return buffer;
  }

  use(key: string, buffer: GPUBuffer): void {
    this.workingSet.set(key, buffer);
    this.newCount++;
  }

  endDraw(): void {
    if (!this.newCount || this.workingSet.size > this.entryLimit) return;
    let totalBytes = 0;
    let addedBytes = 0;
    for (const [key, buffer] of this.workingSet) {
      totalBytes += buffer.size;
      if (!this.resident.has(key)) addedBytes += buffer.size;
    }
    if (totalBytes > this.byteLimit) return;

    // Hits were moved to the end. A fitting draw can evict only older,
    // unrelated streams until there is room for every newly used stream.
    while (this.residentBytes + addedBytes > this.byteLimit || this.resident.size + this.newCount > this.entryLimit) {
      const [key, buffer] = this.resident.entries().next().value!;
      this.resident.delete(key);
      this.residentBytes -= buffer.size;
      this.retire(buffer);
    }
    for (const [key, buffer] of this.workingSet) {
      if (this.resident.has(key)) continue;
      this.resident.set(key, buffer);
      this.residentBytes += buffer.size;
      this.retain(buffer);
    }
  }

  clear(): void {
    this.resident.clear();
    this.residentBytes = 0;
    this.beginDraw();
  }
}

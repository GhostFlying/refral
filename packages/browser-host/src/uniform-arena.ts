const pageBytes = 256 * 1024;
const retainedPages = 2;

function align(size: number, multiple: number): number {
  return Math.ceil(size / multiple) * multiple;
}

interface UniformPage {
  buffer: GPUBuffer;
  data: Uint8Array<ArrayBuffer>;
  groups: WeakMap<GPUBindGroupLayout, GPUBindGroup>;
  used: number;
}

export class UniformArena {
  private readonly pages: UniformPage[] = [];
  private current = 0;
  private readonly alignment: number;
  private readonly pageSize: number;

  constructor(private readonly device: GPUDevice, private readonly allocate: (size: number) => GPUBuffer,
    private readonly countGroup: () => void) {
    this.alignment = device.limits.minUniformBufferOffsetAlignment;
    const limit = device.limits.maxUniformBufferBindingSize;
    this.pageSize = Math.max(pageBytes, align(limit, this.alignment) + limit);
  }

  stage(layout: GPUBindGroupLayout, vertex: Uint8Array, fragment: Uint8Array) {
    const vertexSize = Math.max(4, align(vertex.byteLength, 4));
    const fragmentSize = Math.max(4, align(fragment.byteLength, 4));
    const fragmentStart = align(vertexSize, this.alignment);
    const required = fragmentStart + fragmentSize;
    let page: UniformPage | undefined = this.pages[this.current];
    let start = align(page?.used ?? 0, this.alignment);
    if (start + required > this.pageSize) {
      page = this.pages[++this.current];
      start = 0;
    }
    if (!page) {
      page = { buffer: this.allocate(this.pageSize), data: new Uint8Array(this.pageSize), groups: new WeakMap(), used: 0 };
      this.pages.push(page);
    }
    const fragmentOffset = start + fragmentStart;
    // Clear only padding within a binding. Unbound alignment gaps are never read by shaders.
    page.data.set(vertex, start);
    if (vertex.byteLength !== vertexSize) page.data.fill(0, start + vertex.byteLength, start + vertexSize);
    page.data.set(fragment, fragmentOffset);
    if (fragment.byteLength !== fragmentSize) page.data.fill(0, fragmentOffset + fragment.byteLength, start + required);
    page.used = start + required;
    let group = page.groups.get(layout);
    if (!group) {
      group = this.device.createBindGroup({ layout, entries: [
        { binding: 0, resource: { buffer: page.buffer, size: vertexSize } },
        { binding: 1, resource: { buffer: page.buffer, size: fragmentSize } },
      ] });
      this.countGroup();
      page.groups.set(layout, group);
    }
    return { group, offsets: [start, fragmentOffset] };
  }

  upload(write: (buffer: GPUBuffer, data: Uint8Array<ArrayBuffer>, bytes: number) => void,
    retire: (buffer: GPUBuffer) => void): void {
    for (const page of this.pages) {
      if (page.used) write(page.buffer, page.data, page.used);
      page.used = 0;
    }
    // Queue writes for the next encoder follow the submission that consumes these ranges.
    while (this.pages.length > retainedPages) retire(this.pages.pop()!.buffer);
    this.current = 0;
  }

  clear(): void {
    this.pages.length = 0;
  }
}

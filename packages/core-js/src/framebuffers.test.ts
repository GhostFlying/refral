import { describe, expect, it, vi } from "vitest";
import { GL, SemanticContext } from "./index.js";
import type { Compiler, SemanticHost } from "@refral/core-api";

function createContext() {
  const host = { limits: { maxTextureDimension2D: 4096 }, draw() {}, clear() {}, flush() {}, replaceStorage() {},
    retireStorage: vi.fn<SemanticHost["retireStorage"]>(), retireDepth: vi.fn<SemanticHost["retireDepth"]>(),
  } satisfies SemanticHost;
  const compiler: Compiler = {
    compile() { throw new Error("Framebuffer tests must not compile shaders."); },
    link() { throw new Error("Framebuffer tests must not link programs."); },
  };
  const core = new SemanticContext({ width: 64, height: 32 }, host, compiler, {}, {
    vertexAttributes: 4, vertexUniformVectors: 128, fragmentUniformVectors: 64,
    varyingVectors: 8, vertexTextureUnits: 4, fragmentTextureUnits: 4, combinedTextureUnits: 4,
  });
  return { core, host };
}

function createAttachments(core: SemanticContext) {
  const texture = core.createTexture()!;
  core.bindTexture(GL.TEXTURE_2D, texture);
  core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 2, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
  const depth = core.createRenderbuffer()!;
  core.bindRenderbuffer(GL.RENDERBUFFER, depth);
  core.renderbufferStorage(GL.RENDERBUFFER, GL.DEPTH_COMPONENT16, 2, 2);
  return { texture, depth };
}

describe("JS framebuffer and resource lifetime semantics", () => {
  it.each([
    { suffix: "Framebuffer", target: GL.FRAMEBUFFER, binding: GL.FRAMEBUFFER_BINDING },
    { suffix: "Renderbuffer", target: GL.RENDERBUFFER, binding: GL.RENDERBUFFER_BINDING },
  ])("initializes $suffix only after first successful binding", ({ suffix, target, binding }) => {
    const { core } = createContext();
    const object = core.invoke(`create${suffix}`, []);
    expect(core.invoke(`is${suffix}`, [object])).toBe(false);
    core.invoke(`bind${suffix}`, [-1, object]);
    expect(core.getError()).toBe(GL.INVALID_ENUM);
    expect(core.invoke(`is${suffix}`, [object])).toBe(false);
    core.invoke(`bind${suffix}`, [target, object]);
    expect(core.invoke(`is${suffix}`, [object])).toBe(true);
    core.invoke(`bind${suffix}`, [target, null]);
    expect(core.invoke(`is${suffix}`, [object])).toBe(true);
    core.invoke(`delete${suffix}`, [object]);
    core.invoke(`delete${suffix}`, [object]);
    expect(core.invoke(`is${suffix}`, [object])).toBe(false);
    expect(core.getParameter(binding)).toBeNull();
    expect(core.getError()).toBe(GL.NO_ERROR);
    core.invoke(`bind${suffix}`, [target, object]);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
  });

  it("rejects never-bound texture and renderbuffer names as attachments without changing the framebuffer", () => {
    const { core } = createContext();
    const framebuffer = core.createFramebuffer()!;
    core.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
    const texture = core.createTexture()!;
    const depth = core.createRenderbuffer()!;
    core.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, texture, 0);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    core.framebufferRenderbuffer(GL.FRAMEBUFFER, GL.DEPTH_ATTACHMENT, GL.RENDERBUFFER, depth);
    expect(core.getError()).toBe(GL.INVALID_OPERATION);
    expect(core.getFramebufferAttachmentParameter(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE)).toBe(GL.NONE);
    expect(core.getFramebufferAttachmentParameter(GL.FRAMEBUFFER, GL.DEPTH_ATTACHMENT, GL.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE)).toBe(GL.NONE);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("initializes renderbuffer query state and validates invalid versus unsupported storage formats atomically", () => {
    const { core, host } = createContext();
    const depth = core.createRenderbuffer()!;
    core.bindRenderbuffer(GL.RENDERBUFFER, depth);
    expect(core.getRenderbufferParameter(GL.RENDERBUFFER, GL.RENDERBUFFER_INTERNAL_FORMAT)).toBe(GL.RGBA4);
    expect(core.getRenderbufferParameter(GL.RENDERBUFFER, GL.RENDERBUFFER_WIDTH)).toBe(0);
    expect(core.getRenderbufferParameter(GL.RENDERBUFFER, GL.RENDERBUFFER_HEIGHT)).toBe(0);
    expect(core.getRenderbufferParameter(GL.RENDERBUFFER, GL.RENDERBUFFER_DEPTH_SIZE)).toBe(0);
    core.renderbufferStorage(GL.RENDERBUFFER, GL.DEPTH_COMPONENT16, 2, 3);
    expect(core.getRenderbufferParameter(GL.RENDERBUFFER, GL.RENDERBUFFER_DEPTH_SIZE)).toBeGreaterThanOrEqual(16);
    const generation = depth.generation;
    const retirements = host.retireDepth.mock.calls.length;
    core.renderbufferStorage(GL.RENDERBUFFER, -1, 4, 5);
    expect(core.getError()).toBe(GL.INVALID_ENUM);
    core.renderbufferStorage(GL.RENDERBUFFER, GL.DEPTH_COMPONENT16, -1, 5);
    expect(core.getError()).toBe(GL.INVALID_VALUE);
    expect(() => core.renderbufferStorage(GL.RENDERBUFFER, GL.RGBA4, 4, 5)).toThrow(/outside/);
    expect(core.getError()).toBe(GL.NO_ERROR);
    expect(depth).toMatchObject({ width: 2, height: 3, format: GL.DEPTH_COMPONENT16, generation });
    expect(host.retireDepth.mock.calls).toHaveLength(retirements);
  });

  it("distinguishes missing, undefined, mismatched, and complete color/depth attachments", () => {
    const { core } = createContext();
    const framebuffer = core.createFramebuffer()!;
    core.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
    expect(core.checkFramebufferStatus(GL.FRAMEBUFFER)).toBe(GL.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT);
    const texture = core.createTexture()!;
    core.bindTexture(GL.TEXTURE_2D, texture);
    core.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, texture, 0);
    expect(core.checkFramebufferStatus(GL.FRAMEBUFFER)).toBe(GL.FRAMEBUFFER_INCOMPLETE_ATTACHMENT);
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 2, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    expect(core.checkFramebufferStatus(GL.FRAMEBUFFER)).toBe(GL.FRAMEBUFFER_COMPLETE);
    const depth = core.createRenderbuffer()!;
    core.bindRenderbuffer(GL.RENDERBUFFER, depth);
    core.framebufferRenderbuffer(GL.FRAMEBUFFER, GL.DEPTH_ATTACHMENT, GL.RENDERBUFFER, depth);
    expect(core.checkFramebufferStatus(GL.FRAMEBUFFER)).toBe(GL.FRAMEBUFFER_INCOMPLETE_ATTACHMENT);
    core.renderbufferStorage(GL.RENDERBUFFER, GL.DEPTH_COMPONENT16, 3, 2);
    expect(core.checkFramebufferStatus(GL.FRAMEBUFFER)).toBe(GL.FRAMEBUFFER_INCOMPLETE_DIMENSIONS);
    core.renderbufferStorage(GL.RENDERBUFFER, GL.DEPTH_COMPONENT16, 2, 2);
    expect(core.checkFramebufferStatus(GL.FRAMEBUFFER)).toBe(GL.FRAMEBUFFER_COMPLETE);
    core.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, null, 0);
    expect(core.checkFramebufferStatus(GL.FRAMEBUFFER)).toBe(GL.FRAMEBUFFER_UNSUPPORTED);
    core.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, texture, 0);
    core.texImage2D(GL.TEXTURE_2D, 0, GL.RGB, 2, 2, 0, GL.RGB, GL.UNSIGNED_BYTE, null);
    expect(core.checkFramebufferStatus(GL.FRAMEBUFFER)).toBe(GL.FRAMEBUFFER_UNSUPPORTED);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("queries color and depth bits from the current framebuffer", () => {
    const { core } = createContext();
    expect(core.getParameter(GL.ALPHA_BITS)).toBe(0);
    expect(core.getParameter(GL.DEPTH_BITS)).toBe(0);
    const { texture, depth } = createAttachments(core);
    core.bindFramebuffer(GL.FRAMEBUFFER, core.createFramebuffer());
    core.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, texture, 0);
    expect(core.getParameter(GL.RED_BITS)).toBe(8);
    expect(core.getParameter(GL.ALPHA_BITS)).toBe(8);
    expect(core.getParameter(GL.DEPTH_BITS)).toBe(0);
    core.framebufferRenderbuffer(GL.FRAMEBUFFER, GL.DEPTH_ATTACHMENT, GL.RENDERBUFFER, depth);
    expect(core.getParameter(GL.DEPTH_BITS)).toBeGreaterThanOrEqual(16);
    core.deleteRenderbuffer(depth);
    expect(core.getParameter(GL.DEPTH_BITS)).toBe(0);
    core.bindFramebuffer(GL.FRAMEBUFFER, null);
    expect(core.getParameter(GL.ALPHA_BITS)).toBe(0);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("validates attachment queries according to the actual attached object type", () => {
    const { core } = createContext();
    const framebuffer = core.createFramebuffer()!;
    core.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
    expect(core.getFramebufferAttachmentParameter(GL.FRAMEBUFFER, GL.DEPTH_ATTACHMENT, GL.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE)).toBe(GL.NONE);
    expect(core.getError()).toBe(GL.NO_ERROR);
    for (const parameter of [GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME, GL.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL,
      GL.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE]) {
      expect(core.getFramebufferAttachmentParameter(GL.FRAMEBUFFER, GL.DEPTH_ATTACHMENT, parameter)).toBeNull();
      expect(core.getError()).toBe(GL.INVALID_ENUM);
    }
    const { texture, depth } = createAttachments(core);
    core.framebufferRenderbuffer(GL.FRAMEBUFFER, GL.DEPTH_ATTACHMENT, GL.RENDERBUFFER, depth);
    expect(core.getFramebufferAttachmentParameter(GL.FRAMEBUFFER, GL.DEPTH_ATTACHMENT, GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)).toBe(depth);
    expect(core.getError()).toBe(GL.NO_ERROR);
    for (const parameter of [GL.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL, GL.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE]) {
      expect(core.getFramebufferAttachmentParameter(GL.FRAMEBUFFER, GL.DEPTH_ATTACHMENT, parameter)).toBeNull();
      expect(core.getError()).toBe(GL.INVALID_ENUM);
    }
    core.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, texture, 0);
    expect(core.getFramebufferAttachmentParameter(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL)).toBe(0);
    expect(core.getFramebufferAttachmentParameter(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE)).toBe(0);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });

  it("keeps shared unbound framebuffer references after bound deletion and retires the final attachment once", () => {
    const { core, host } = createContext();
    const { texture, depth } = createAttachments(core);
    const storage = texture.storage;
    const first = core.createFramebuffer()!;
    const second = core.createFramebuffer()!;
    for (const framebuffer of [first, second]) {
      core.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
      core.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, texture, 0);
      core.framebufferRenderbuffer(GL.FRAMEBUFFER, GL.DEPTH_ATTACHMENT, GL.RENDERBUFFER, depth);
    }
    core.bindFramebuffer(GL.FRAMEBUFFER, first);
    host.retireDepth.mockClear();
    core.deleteTexture(texture);
    core.deleteRenderbuffer(depth);
    expect(first.color).toBeNull();
    expect(first.depth).toBeNull();
    expect(second.color).toBe(texture);
    expect(second.depth).toBe(depth);
    expect(host.retireStorage).not.toHaveBeenCalled();
    expect(host.retireDepth).not.toHaveBeenCalled();
    core.deleteFramebuffer(first);
    core.bindFramebuffer(GL.FRAMEBUFFER, second);
    core.deleteTexture(texture);
    core.deleteRenderbuffer(depth);
    expect(second.color).toBe(texture);
    expect(second.depth).toBe(depth);
    expect(host.retireStorage).not.toHaveBeenCalled();
    expect(host.retireDepth).not.toHaveBeenCalled();
    expect(core.getFramebufferAttachmentParameter(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)).toBe(texture);
    core.deleteFramebuffer(second);
    core.deleteFramebuffer(second);
    expect(host.retireStorage).toHaveBeenCalledExactlyOnceWith(storage);
    expect(host.retireDepth).toHaveBeenCalledExactlyOnceWith(depth.id, 1);
    expect(core.getError()).toBe(GL.NO_ERROR);
  });
});

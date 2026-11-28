#include <bit>
#include <cstring>
#include <stdexcept>

#include "backend.h"
#include "device.h"

extern "C" {
struct State;
State* rf_new(const char*);
void rf_drop(State*);
void rf_uniform(State*, uint32_t, float);
bool rf_draw(State*, uint32_t, int32_t, int32_t, uint8_t*, size_t);
bool rf_clear(State*);
}
namespace bench {
std::unique_ptr<Backend> createAngle(const Config&);
namespace {
struct Calibration : Backend {
  uint32_t sum = 0;
  void uniform(unsigned slot, float x) override {
    sum += slot + std::bit_cast<uint32_t>(x);
  }
  void draw(unsigned m, int f, int n) override { sum += m + f + n; }
  void clear() override {}
  void flush() override {}
  void finish() override {}
  std::vector<uint8_t> pixels() override {
    return {uint8_t(sum), uint8_t(sum >> 8), uint8_t(sum >> 16),
            uint8_t(sum >> 24)};
  }
};
struct RustHost : Backend {
  Device gpu;
  std::unique_ptr<State, decltype(&rf_drop)> core;
  unsigned stride, used = 0, uniformBytes;
  std::vector<uint8_t> staging;
  WGPUTexture target;
  WGPUTextureView view;
  WGPURenderPipeline pipeline;
  WGPUBindGroup groups[3];
  WGPUBuffer arena;
  std::vector<WGPUBuffer> buffers, vertices;
  WGPUCommandEncoder encoder{};
  WGPURenderPassEncoder pass{};
  WGPUBuffer buffer(size_t n, WGPUBufferUsage usage,
                    const void* data = nullptr) {
    WGPUBufferDescriptor desc = WGPU_BUFFER_DESCRIPTOR_INIT;
    desc.size = n;
    desc.usage = usage | WGPUBufferUsage_CopyDst;
    auto b = wgpuDeviceCreateBuffer(gpu.device, &desc);
    buffers.push_back(b);
    if (data) wgpuQueueWriteBuffer(gpu.queue, b, 0, data, n);
    return b;
  }
  WGPUShaderModule shader(const std::string& code) {
    WGPUShaderSourceWGSL src = WGPU_SHADER_SOURCE_WGSL_INIT;
    src.code = {code.data(), code.size()};
    WGPUShaderModuleDescriptor desc = WGPU_SHADER_MODULE_DESCRIPTOR_INIT;
    desc.nextInChain = &src.chain;
    return wgpuDeviceCreateShaderModule(gpu.device, &desc);
  }
  explicit RustHost(const Config& c)
      : core(rf_new(c.json.c_str()), rf_drop), uniformBytes(c.uniformBytes) {
    if (!core)
      throw std::runtime_error("native Refral core initialization failed");
    adapter = gpu.name;
    WGPULimits limits = WGPU_LIMITS_INIT;
    wgpuDeviceGetLimits(gpu.device, &limits);
    const auto align = limits.minUniformBufferOffsetAlignment;
    stride = (uniformBytes + align - 1) / align * align;
    staging.resize(maxDraws * stride);
    arena = buffer(staging.size(), WGPUBufferUsage_Uniform);
    WGPUTextureDescriptor td = WGPU_TEXTURE_DESCRIPTOR_INIT;
    td.size = {width, height, 1};
    td.format = WGPUTextureFormat_RGBA8Unorm;
    td.usage = WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc;
    target = wgpuDeviceCreateTexture(gpu.device, &td);
    view = wgpuTextureCreateView(target, nullptr);
    // Match the browser host driver block for the default 800 x 600 surface.
    uint32_t driver[8] = {0,
                          std::bit_cast<uint32_t>(1.0f),
                          (height << 16) | width,
                          0x817f7f7f,
                          1u << 20,
                          0,
                          0,
                          0};
    auto driverBuf = buffer(sizeof(driver), WGPUBufferUsage_Uniform, driver);
    WGPUBindGroupLayout layouts[3];
    for (unsigned i = 0; i < 3; i++) {
      WGPUBindGroupLayoutEntry e = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
      e.binding = 0;
      e.visibility = i == 0 ? WGPUShaderStage_Vertex
                            : WGPUShaderStage_Vertex | WGPUShaderStage_Fragment;
      e.buffer.type = WGPUBufferBindingType_Uniform;
      e.buffer.hasDynamicOffset = i == 0;
      size_t size = i == 0 ? uniformBytes : sizeof(driver);
      e.buffer.minBindingSize = size;
      WGPUBindGroupLayoutDescriptor l = WGPU_BIND_GROUP_LAYOUT_DESCRIPTOR_INIT;
      l.entryCount = i == 1 ? 0 : 1;
      l.entries = &e;
      layouts[i] = wgpuDeviceCreateBindGroupLayout(gpu.device, &l);
      WGPUBindGroupEntry binding = WGPU_BIND_GROUP_ENTRY_INIT;
      binding.buffer = i == 0 ? arena : driverBuf;
      binding.size = size;
      WGPUBindGroupDescriptor g = WGPU_BIND_GROUP_DESCRIPTOR_INIT;
      g.layout = layouts[i];
      g.entryCount = l.entryCount;
      g.entries = &binding;
      groups[i] = wgpuDeviceCreateBindGroup(gpu.device, &g);
    }
    WGPUPipelineLayoutDescriptor pl = WGPU_PIPELINE_LAYOUT_DESCRIPTOR_INIT;
    pl.bindGroupLayoutCount = 3;
    pl.bindGroupLayouts = layouts;
    auto layout = wgpuDeviceCreatePipelineLayout(gpu.device, &pl);
    auto vs = shader(c.vertexWGSL), fs = shader(c.fragmentWGSL);
    WGPUVertexAttribute attr[2];
    WGPUVertexBufferLayout streams[2];
    for (unsigned i = 0; i < 2; i++) {
      attr[i] = WGPU_VERTEX_ATTRIBUTE_INIT;
      attr[i].format = WGPUVertexFormat_Float32x4;
      attr[i].shaderLocation = i;
      streams[i] = WGPU_VERTEX_BUFFER_LAYOUT_INIT;
      streams[i].arrayStride = 16;
      streams[i].stepMode = WGPUVertexStepMode_Vertex;
      streams[i].attributes = &attr[i];
      streams[i].attributeCount = 1;
      vertices.push_back(buffer(c.streams[i].size() * 4, WGPUBufferUsage_Vertex,
                                c.streams[i].data()));
    }
    WGPUColorTargetState color = WGPU_COLOR_TARGET_STATE_INIT;
    color.format = td.format;
    WGPUFragmentState frag = WGPU_FRAGMENT_STATE_INIT;
    frag.module = fs;
    frag.entryPoint = {c.fragmentEntry.data(), c.fragmentEntry.size()};
    frag.targetCount = 1;
    frag.targets = &color;
    WGPURenderPipelineDescriptor pd = WGPU_RENDER_PIPELINE_DESCRIPTOR_INIT;
    pd.layout = layout;
    pd.vertex.module = vs;
    pd.vertex.entryPoint = {c.vertexEntry.data(), c.vertexEntry.size()};
    pd.vertex.buffers = streams;
    pd.vertex.bufferCount = 2;
    pd.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    pd.fragment = &frag;
    pipeline = wgpuDeviceCreateRenderPipeline(gpu.device, &pd);
    wgpuShaderModuleRelease(vs);
    wgpuShaderModuleRelease(fs);
    wgpuPipelineLayoutRelease(layout);
    for (auto l : layouts) wgpuBindGroupLayoutRelease(l);
  }
  void uniform(unsigned slot, float x) override {
    rf_uniform(core.get(), slot, x);
  }
  void clear() override {
    if (pass || !rf_clear(core.get()))
      throw std::runtime_error("unexpected clear");
    encoder = wgpuDeviceCreateCommandEncoder(gpu.device, nullptr);
    WGPURenderPassColorAttachment color =
        WGPU_RENDER_PASS_COLOR_ATTACHMENT_INIT;
    color.view = view;
    color.loadOp = WGPULoadOp_Clear;
    color.storeOp = WGPUStoreOp_Store;
    color.clearValue = {.5, .5, .5, 1};
    WGPURenderPassDescriptor pd = WGPU_RENDER_PASS_DESCRIPTOR_INIT;
    pd.colorAttachmentCount = 1;
    pd.colorAttachments = &color;
    pass = wgpuCommandEncoderBeginRenderPass(encoder, &pd);
    wgpuRenderPassEncoderSetPipeline(pass, pipeline);
    for (unsigned i = 0; i < 2; i++)
      wgpuRenderPassEncoderSetVertexBuffer(pass, i, vertices[i], 0,
                                           WGPU_WHOLE_SIZE);
    for (unsigned i = 1; i < 3; i++)
      wgpuRenderPassEncoderSetBindGroup(pass, i, groups[i], 0, nullptr);
  }
  void draw(unsigned mode, int first, int count) override {
    uint32_t offset = used * stride;
    if (!pass || used >= maxDraws ||
        !rf_draw(core.get(), mode, first, count, staging.data() + offset,
                 uniformBytes))
      throw std::runtime_error("unexpected native draw");
    wgpuRenderPassEncoderSetBindGroup(pass, 0, groups[0], 1, &offset);
    wgpuRenderPassEncoderDraw(pass, count, 1, first, 0);
    used++;
  }
  void submit(WGPUCommandEncoder e) {
    auto cmd = wgpuCommandEncoderFinish(e, nullptr);
    wgpuQueueSubmit(gpu.queue, 1, &cmd);
    wgpuCommandBufferRelease(cmd);
    wgpuCommandEncoderRelease(e);
  }
  void flush() override {
    if (!pass) return;
    wgpuRenderPassEncoderEnd(pass);
    wgpuRenderPassEncoderRelease(pass);
    pass = nullptr;
    if (used)
      wgpuQueueWriteBuffer(gpu.queue, arena, 0, staging.data(),
                           (used - 1) * stride + uniformBytes);
    submit(encoder);
    encoder = nullptr;
    used = 0;
  }
  void finish() override { gpu.finish(); }
  std::vector<uint8_t> pixels() override {
    constexpr unsigned row = (width * 4 + 255) / 256 * 256;
    WGPUBufferDescriptor bd = WGPU_BUFFER_DESCRIPTOR_INIT;
    bd.size = row * height;
    bd.usage = WGPUBufferUsage_CopyDst | WGPUBufferUsage_MapRead;
    auto b = wgpuDeviceCreateBuffer(gpu.device, &bd);
    auto enc = wgpuDeviceCreateCommandEncoder(gpu.device, nullptr);
    WGPUTexelCopyTextureInfo src = WGPU_TEXEL_COPY_TEXTURE_INFO_INIT;
    src.texture = target;
    WGPUTexelCopyBufferInfo dst = WGPU_TEXEL_COPY_BUFFER_INFO_INIT;
    dst.buffer = b;
    dst.layout.bytesPerRow = row;
    dst.layout.rowsPerImage = height;
    WGPUExtent3D extent = {width, height, 1};
    wgpuCommandEncoderCopyTextureToBuffer(enc, &src, &dst, &extent);
    submit(enc);
    bool ok = false;
    WGPUBufferMapCallbackInfo cb = WGPU_BUFFER_MAP_CALLBACK_INFO_INIT;
    cb.mode = WGPUCallbackMode_WaitAnyOnly;
    cb.userdata1 = &ok;
    cb.callback = [](WGPUMapAsyncStatus status, WGPUStringView, void* p,
                     void*) {
      *static_cast<bool*>(p) = status == WGPUMapAsyncStatus_Success;
    };
    gpu.wait(wgpuBufferMapAsync(b, WGPUMapMode_Read, 0, bd.size, cb));
    if (!ok) throw std::runtime_error("readback map");
    auto data = static_cast<const uint8_t*>(
        wgpuBufferGetConstMappedRange(b, 0, bd.size));
    std::vector<uint8_t> p(width * height * 4);
    // The offscreen texture uses GL row order. PNG row zero is the top.
    for (unsigned y = 0; y < height; y++)
      std::memcpy(p.data() + y * width * 4, data + (height - 1 - y) * row,
                  width * 4);
    wgpuBufferUnmap(b);
    wgpuBufferRelease(b);
    return p;
  }
  ~RustHost() {
    for (auto group : groups) wgpuBindGroupRelease(group);
    wgpuRenderPipelineRelease(pipeline);
    for (auto b : buffers) wgpuBufferRelease(b);
    wgpuTextureViewRelease(view);
    wgpuTextureRelease(target);
  }
};
}  // namespace
std::unique_ptr<Backend> create(const std::string& name, const Config& config) {
  if (name == "angle") return createAngle(config);
  if (name == "rust") return std::make_unique<RustHost>(config);
  if (name == "calibration") return std::make_unique<Calibration>();
  throw std::runtime_error("unknown native backend");
}
}  // namespace bench

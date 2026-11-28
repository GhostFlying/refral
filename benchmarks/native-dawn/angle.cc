#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <EGL/eglext_angle.h>
#include <GLES2/gl2.h>
#include <dawn/dawn_proc.h>

#include <algorithm>
#ifdef REFRAL_COUNT_ALLOCATIONS
#include <cstdio>
#endif
#include <stdexcept>

#include "backend.h"
#include "device.h"
namespace dawn::native {
const DawnProcTable& GetProcs();
}
extern "C" void (*rfAngleProc(const char*))();
namespace bench {
namespace {
#ifdef REFRAL_COUNT_ALLOCATIONS
// Audit build only. finish() delimits a frame after queue completion.
unsigned buffersCreated, groupsCreated;
const DawnProcTable& countingProcs() {
  static DawnProcTable table = dawn::native::GetProcs();
  table.deviceCreateBuffer = [](WGPUDevice d,
                                const WGPUBufferDescriptor* desc) {
    ++buffersCreated;
    return dawn::native::GetProcs().deviceCreateBuffer(d, desc);
  };
  table.deviceCreateBindGroup = [](WGPUDevice d,
                                   const WGPUBindGroupDescriptor* desc) {
    ++groupsCreated;
    return dawn::native::GetProcs().deviceCreateBindGroup(d, desc);
  };
  return table;
}
#endif
template <class T>
T load(const char* name) {
  auto f = rfAngleProc(name);
  if (!f) throw std::runtime_error(name);
  return reinterpret_cast<T>(f);
}
#define PROC(f) decltype(&::f) f = load<decltype(&::f)>(#f)
struct Angle : Backend {
  Device gpu;
  PROC(eglGetPlatformDisplay);
  PROC(eglInitialize);
  PROC(eglChooseConfig);
  PROC(eglGetError);
  PROC(eglCreateContext);
  PROC(eglMakeCurrent);
  PROC(eglDestroyContext);
  PROC(eglTerminate);
  PROC(glGenTextures);
  PROC(glBindTexture);
  PROC(glTexImage2D);
  PROC(glGenFramebuffers);
  PROC(glBindFramebuffer);
  PROC(glFramebufferTexture2D);
  PROC(glCheckFramebufferStatus);
  PROC(glClearColor);
  PROC(glViewport);
  PROC(glGetString);
  PROC(glCreateShader);
  PROC(glShaderSource);
  PROC(glCompileShader);
  PROC(glGetShaderiv);
  PROC(glGetShaderInfoLog);
  PROC(glAttachShader);
  PROC(glCreateProgram);
  PROC(glBindAttribLocation);
  PROC(glLinkProgram);
  PROC(glUseProgram);
  PROC(glGetProgramiv);
  PROC(glGenBuffers);
  PROC(glBindBuffer);
  PROC(glBufferData);
  PROC(glVertexAttribPointer);
  PROC(glEnableVertexAttribArray);
  PROC(glGetUniformLocation);
  PROC(glUniform1f);
  PROC(glDrawArrays);
  PROC(glClear);
  PROC(glFlush);
  PROC(glGetError);
  PROC(glReadPixels);
  EGLDisplay display;
  EGLContext ctx;
  std::vector<GLint> locations;
  explicit Angle(const Config& c) {
#ifdef REFRAL_COUNT_ALLOCATIONS
    const auto& procs = countingProcs();
#else
    const auto& procs = dawn::native::GetProcs();
#endif
    EGLAttrib attr[] = {EGL_PLATFORM_ANGLE_TYPE_ANGLE,
                        EGL_PLATFORM_ANGLE_TYPE_WEBGPU_ANGLE,
                        EGL_PLATFORM_ANGLE_DAWN_PROC_TABLE_ANGLE,
                        reinterpret_cast<EGLAttrib>(&procs),
                        EGL_PLATFORM_ANGLE_WEBGPU_INSTANCE_ANGLE,
                        reinterpret_cast<EGLAttrib>(gpu.instance),
                        EGL_PLATFORM_ANGLE_WEBGPU_DEVICE_ANGLE,
                        reinterpret_cast<EGLAttrib>(gpu.device),
                        EGL_NONE};
    display = eglGetPlatformDisplay(EGL_PLATFORM_ANGLE_ANGLE, nullptr, attr);
    EGLConfig cfg;
    EGLint n = 0;
    EGLint format[] = {EGL_SURFACE_TYPE,
                       EGL_PBUFFER_BIT,
                       EGL_RENDERABLE_TYPE,
                       EGL_OPENGL_ES2_BIT,
                       EGL_RED_SIZE,
                       8,
                       EGL_GREEN_SIZE,
                       8,
                       EGL_BLUE_SIZE,
                       8,
                       EGL_ALPHA_SIZE,
                       8,
                       EGL_SAMPLES,
                       0,
                       EGL_NONE};
    if (!eglInitialize(display, nullptr, nullptr) ||
        !eglChooseConfig(display, format, &cfg, 1, &n) || !n)
      throw std::runtime_error("EGL configuration");
    const EGLint version[] = {EGL_CONTEXT_CLIENT_VERSION, 2,
                              EGL_CONTEXT_WEBGL_COMPATIBILITY_ANGLE, EGL_TRUE,
                              EGL_NONE};
    ctx = eglCreateContext(display, cfg, EGL_NO_CONTEXT, version);
    if (ctx == EGL_NO_CONTEXT ||
        !eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, ctx))
      throw std::runtime_error("surfaceless EGL context: " +
                               std::to_string(eglGetError()));
    adapter = gpu.name + " / " +
              reinterpret_cast<const char*>(glGetString(GL_RENDERER));
    if (adapter.find("WebGPU") == std::string::npos)
      throw std::runtime_error("ANGLE selected another backend");
    GLuint tex, fbo;
    glGenTextures(1, &tex);
    glBindTexture(GL_TEXTURE_2D, tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA,
                 GL_UNSIGNED_BYTE, nullptr);
    glGenFramebuffers(1, &fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D,
                           tex, 0);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE)
      throw std::runtime_error("incomplete RGBA framebuffer");
    GLuint p = glCreateProgram();
    for (auto stage : {GL_VERTEX_SHADER, GL_FRAGMENT_SHADER}) {
      GLuint s = glCreateShader(stage);
      const char* src = (stage == GL_VERTEX_SHADER ? c.vs : c.fs).c_str();
      glShaderSource(s, 1, &src, nullptr);
      glCompileShader(s);
      GLint ok;
      glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
      if (!ok) {
        char log[2048]{};
        glGetShaderInfoLog(s, sizeof(log), nullptr, log);
        throw std::runtime_error(log);
      }
      glAttachShader(p, s);
    }
    for (unsigned i = 0; i < c.attributes.size(); i++)
      glBindAttribLocation(p, i, c.attributes[i].c_str());
    glLinkProgram(p);
    GLint linked;
    glGetProgramiv(p, GL_LINK_STATUS, &linked);
    if (!linked) throw std::runtime_error("ANGLE link");
    glUseProgram(p);
    for (auto& name : c.uniforms) {
      auto loc = glGetUniformLocation(p, name.c_str());
      if (loc < 0) throw std::runtime_error(name);
      locations.push_back(loc);
    }
    for (unsigned i = 0; i < c.streams.size(); i++) {
      GLuint b;
      glGenBuffers(1, &b);
      glBindBuffer(GL_ARRAY_BUFFER, b);
      glBufferData(GL_ARRAY_BUFFER, c.streams[i].size() * 4,
                   c.streams[i].data(), GL_STATIC_DRAW);
      glVertexAttribPointer(i, 4, GL_FLOAT, false, 0, nullptr);
      glEnableVertexAttribArray(i);
    }
    glViewport(0, 0, width, height);
    glClearColor(.5, .5, .5, 1);
    check();
  }
  void check() {
    auto error = glGetError();
    if (error) throw std::runtime_error("GL error " + std::to_string(error));
  }
  void uniform(unsigned slot, float x) override {
    glUniform1f(locations[slot], x);
  }
  void draw(unsigned mode, int first, int count) override {
    glDrawArrays(mode, first, count);
  }
  void clear() override { glClear(GL_COLOR_BUFFER_BIT); }
  void flush() override { glFlush(); }
  void finish() override {
    gpu.finish();
    check();
#ifdef REFRAL_COUNT_ALLOCATIONS
    std::fprintf(stderr, "ANGLE Dawn allocations: %u buffers, %u bind groups\n",
                 buffersCreated, groupsCreated);
    buffersCreated = groupsCreated = 0;
#endif
  }
  std::vector<uint8_t> pixels() override {
    std::vector<uint8_t> p(width * height * 4);
    glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, p.data());
    check();
    for (unsigned y = 0; y < height / 2; y++)
      std::swap_ranges(p.begin() + y * width * 4,
                       p.begin() + (y + 1) * width * 4,
                       p.begin() + (height - 1 - y) * width * 4);
    return p;
  }
  ~Angle() {
    eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglDestroyContext(display, ctx);
    eglTerminate(display);
  }
};
}  // namespace
std::unique_ptr<Backend> createAngle(const Config& c) {
  return std::make_unique<Angle>(c);
}
}  // namespace bench

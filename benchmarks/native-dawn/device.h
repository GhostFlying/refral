#pragma once
#include <dawn/webgpu.h>

#include <string>

namespace bench {
struct Device {
  Device();
  ~Device();
  void wait(WGPUFuture f);
  void finish();
  WGPUInstance instance{};
  WGPUAdapter adapter{};
  WGPUDevice device{};
  WGPUQueue queue{};
  std::string name;
};
}  // namespace bench

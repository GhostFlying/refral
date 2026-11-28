#include "device.h"

#include <dawn/dawn_proc.h>

#include <cstdio>
#include <stdexcept>
namespace dawn::native {
const DawnProcTable& GetProcs();
}
namespace bench {
void Device::wait(WGPUFuture f) {
  WGPUFutureWaitInfo w = WGPU_FUTURE_WAIT_INFO_INIT;
  w.future = f;
  if (wgpuInstanceWaitAny(instance, 1, &w, UINT64_MAX) !=
          WGPUWaitStatus_Success ||
      !w.completed)
    throw std::runtime_error("Dawn wait failed");
}
Device::Device() {
  dawnProcSetProcs(&dawn::native::GetProcs());
  WGPUInstanceDescriptor i = WGPU_INSTANCE_DESCRIPTOR_INIT;
  WGPUInstanceFeatureName timed = WGPUInstanceFeatureName_TimedWaitAny;
  i.requiredFeatureCount = 1;
  i.requiredFeatures = &timed;
  instance = wgpuCreateInstance(&i);
  if (!instance) throw std::runtime_error("Dawn instance unavailable");
  WGPURequestAdapterOptions options = WGPU_REQUEST_ADAPTER_OPTIONS_INIT;
  options.backendType = WGPUBackendType_Metal;
  WGPURequestAdapterCallbackInfo cb = WGPU_REQUEST_ADAPTER_CALLBACK_INFO_INIT;
  cb.mode = WGPUCallbackMode_WaitAnyOnly;
  cb.userdata1 = this;
  cb.callback = [](WGPURequestAdapterStatus status, WGPUAdapter a,
                   WGPUStringView, void* self, void*) {
    if (status == WGPURequestAdapterStatus_Success)
      static_cast<Device*>(self)->adapter = a;
  };
  wait(wgpuInstanceRequestAdapter(instance, &options, cb));
  if (!adapter) throw std::runtime_error("Metal adapter unavailable");
  WGPUAdapterInfo info = WGPU_ADAPTER_INFO_INIT;
  wgpuAdapterGetInfo(adapter, &info);
  if (info.backendType != WGPUBackendType_Metal ||
      info.adapterType == WGPUAdapterType_CPU)
    throw std::runtime_error("hardware Metal required");
  name = std::string(info.device.data, info.device.length) + " / " +
         std::string(info.description.data, info.description.length);
  wgpuAdapterInfoFreeMembers(info);
  WGPURequestDeviceCallbackInfo dc = WGPU_REQUEST_DEVICE_CALLBACK_INFO_INIT;
  dc.mode = WGPUCallbackMode_WaitAnyOnly;
  dc.userdata1 = this;
  dc.callback = [](WGPURequestDeviceStatus status, WGPUDevice d, WGPUStringView,
                   void* self, void*) {
    if (status == WGPURequestDeviceStatus_Success)
      static_cast<Device*>(self)->device = d;
  };
  WGPUDeviceDescriptor dd = WGPU_DEVICE_DESCRIPTOR_INIT;
  dd.deviceLostCallbackInfo.mode = WGPUCallbackMode_AllowSpontaneous;
  dd.deviceLostCallbackInfo.callback =
      [](WGPUDevice const*, WGPUDeviceLostReason reason, WGPUStringView message,
         void*, void*) {
        if (reason == WGPUDeviceLostReason_Destroyed ||
            reason == WGPUDeviceLostReason_CallbackCancelled)
          return;
        std::fprintf(stderr, "Dawn device lost: %.*s\n", int(message.length),
                     message.data);
        std::abort();
      };
  dd.uncapturedErrorCallbackInfo.callback = [](WGPUDevice const*, WGPUErrorType,
                                               WGPUStringView msg, void*,
                                               void*) {
    std::fprintf(stderr, "Dawn validation: %.*s\n", int(msg.length), msg.data);
    std::abort();
  };
  wait(wgpuAdapterRequestDevice(adapter, &dd, dc));
  if (!device) throw std::runtime_error("Dawn device unavailable");
  queue = wgpuDeviceGetQueue(device);
}
void Device::finish() {
  bool ok = false;
  WGPUQueueWorkDoneCallbackInfo cb = WGPU_QUEUE_WORK_DONE_CALLBACK_INFO_INIT;
  cb.mode = WGPUCallbackMode_WaitAnyOnly;
  cb.userdata1 = &ok;
  cb.callback = [](WGPUQueueWorkDoneStatus s, WGPUStringView, void* out,
                   void*) {
    *static_cast<bool*>(out) = s == WGPUQueueWorkDoneStatus_Success;
  };
  wait(wgpuQueueOnSubmittedWorkDone(queue, cb));
  if (!ok) throw std::runtime_error("queue completion failed");
}
Device::~Device() {
  wgpuQueueRelease(queue);
  wgpuDeviceRelease(device);
  wgpuAdapterRelease(adapter);
  wgpuInstanceRelease(instance);
}
}  // namespace bench

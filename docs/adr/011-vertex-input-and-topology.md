# ADR 011 — Vertex input and triangle strips

Status is accepted for [task 039](../tasks/039-webgl1-surface-and-vertex-input.md).

Both cores own pointer state, enabled-array validation and byte-range checks against current buffer storage. The draw operation carries the primitive mode and each active attribute's component type, component count, normalization, stride and byte offset. Draw data ownership follows the existing Buffer snapshot contract. The Rust build requires ABI4 with RFD4 draw records. Resource, readback and DOM upload protocol versions remain 3, 1 and 2.

BrowserHost converts attributes into the shader's float component layout on the existing repacking path. This accommodates byte-aligned strides, all four component counts, direct integer conversion, normalized values and default component fill. The vertex cache key includes the source type and normalization. The signed conversion preserves zero as permitted by WebGL1. [WebGL1 conversion](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html#L4585)

The host selects triangle-list or triangle-strip topology from the draw. Indexed strips use a pipeline with the actual index format. If the selected unsigned-short index range contains 65535, the host widens that range into a temporary uint32 index buffer. This keeps the WebGL1 vertex index distinct from WebGPU's all-ones restart marker. A new topology and strip format participate in pipeline cache identity. Ordinary index uploads retain their existing cache. [WebGPU index formats](https://www.w3.org/TR/webgpu/#enumdef-gpuindexformat)

The CTS adapters provide an iframe-local instanceof identity through a wrapper's prototype query. The facade remains the target of member lookup and assignment. Feature detection uses the declared WebGL1 core surface and the supported optional properties. [Official runner adapter](010-official-conformance-adapter.md)

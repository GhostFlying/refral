# ADR 012 — Ordered texture mipmaps

Status is accepted for tasks 043–044.

A texture definition owns an independent logical image for each face and level. Definitions may arrive in any order. The core validates dimensions using the reported limit and computes the set of levels required by the sampled texture's min filter. Each draw resolves the selected version chain in level-major order. Cube faces use the order recorded in ADR 009.

The shared host keeps one canonical WebGPU allocation per logical image. A one-level 2D sampler uses that allocation directly. For cube or multi-level sampling, the host copies the selected versions into a sampler-compatible allocation with the required layers and levels. The cache holds the latest assembled chain per base image. Version changes invalidate the assembled image, and queued work retains retired allocations until completion.

Generation validates the base in each core and publishes one ordered derived-image operation per face and generated level. Its source version is the previous level on that face. The host ends earlier passes and encodes box reduction into the generated allocation at operation time. This preserves source writes before generation and separates later writes from already generated results.

Resource protocol 4 allows each draw binding to carry a mip-level count, with zero denoting incomplete sampling. Protocol 5 adds the generation operation and reserves enough command headers for the largest 32-bit cube chain. The adapter validates chain identity, source level and derived dimensions. ABI4 continues to identify the draw header and Buffer payloads. Reuse of the transport is covered by the actual-Wasm and deployment checks.

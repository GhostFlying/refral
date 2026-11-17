# ADR 009 — Texture image subresources and CubeMap sampling

Status is accepted on 2026-11-17 for task034. Task035 establishes the contract and compiler verification. Task036 integrates the CubeMap runtime.

## Logical images and versions

A texture object retains its context-owned generational handle, first successful binding target and shared sampling parameters. A texture image is identified by that handle, imageTarget and level. The image target is TEXTURE_2D or one of the six cube faces. Each image has independent storage generation and content version. TextureVersion adds optional imageTarget and level, with missing fields normalized to TEXTURE_2D/0 for existing callers and fixtures.

ExecutionResources uses the complete image identity for definition, update, GPU write, lookup and retirement. Content transitions stay within one image. Replacing one cube face preserves the other images and earlier queued draws. GPU writes retain their canonical allocation while advancing the record's current version metadata, allowing an aggregate sampling cache to observe the new content.

The first runtime profile implements level zero. The contract carries level explicitly so future mip resources share the same identity model. A level's execution identity remains separate from API validation and the declared support scope.

## Sampling snapshots and host resources

TextureBinding keeps its legacy storage/parameters fields and adds an optional dimension. Missing dimension means 2D. Cube bindings declare dimension cube and supply six canonical image records in +X,-X,+Y,-Y,+Z,-Z order when complete. Incomplete bindings retain the cube dimension and use the cube black fallback. Cores check active sampler type/unit conflicts before incomplete-texture substitution.

The common host can materialize each logical image through its current 2D allocation path, then compose complete cube faces into a six-layer texture with a cube view. The aggregate cache compares all six image versions. Replacement or content change retires the preceding aggregate through the existing in-flight lifetime mechanism. Keep aggregate caching bounded per live texture object. The host owns all GPU objects and copies.

## Compiler and Wasm boundary

The shared compiler accepts scalar sampler2D and samplerCube, reflecting their GL type and assigning split sampler/texture bindings. Other sampler kinds and arrays retain explicit link diagnostics. Vertex implicit texture sampling uses an explicit base LOD in the pinned WGSL backend adaptation, preserving explicit LOD calls.

Task036 retains ABI3/readback1/DOM2 and advances resource capability to3. TextureVersion packets add imageTarget and level u32 fields. Draw bindings carry a dimension and presence flag followed by one 2D version or six cube versions. Incomplete packets still carry dimension. Every consumer, packet capacity calculation, pre-execution output reservation, stale-artifact check and packaged-module check migrates together. Output arenas retain independent ownership before reuse.

## Validation and acceptance

Pinned GLES2 texture-object rules fix target on first successful binding and keep separate per-unit 2D/Cube bindings. Face definitions validate square size while subimage updates validate their selected rectangular region. Cube completeness checks all six positive images, matching dimensions and logical formats, NPOT restrictions and the declared level/filter profile. Same-unit active sampler types must agree. Source conversion, source/security checks, error-state preservation and deletion follow the shared pinned assertions.

Compiler verification uses axis colors plus nonuniform face texels and off-axis directions. Runtime regressions cover identity, missing/mismatched faces, 1×1/default filters, NPOT, multiple units, source snapshots, ordered face updates, reallocation and final retirement. Task037 runs the three original RGBA DOM generators with all 2D and cube assertions intact. Browser work remains headless with one worker.

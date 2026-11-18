use super::*;
use refral_core::{
    ActiveInfo, Argument, AttributeInfo, CompileOutcome, LinkOutcome, ObjectHandle, ObjectKind,
    PixelView, ProgramLayout, Reply, TextureImages, UniformInfo,
};
use serde::Deserialize;
use serde_json::{json, Value};

const MAX_METADATA_BYTES: usize = 16 * 1024 * 1024;

#[no_mangle]
pub extern "C" fn rf_vertex_array_protocol_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn rf_resource_protocol_version() -> u32 {
    8
}

#[no_mangle]
pub extern "C" fn rf_readback_protocol_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn rf_dom_upload_protocol_version() -> u32 {
    2
}

#[derive(Default)]
pub(super) struct Transport {
    metadata: Vec<u8>,
    input: Vec<u8>,
    output: Vec<u8>,
    binary: Vec<u8>,
    prepared: bool,
    resource_before: Vec<refral_core::ResourceOperation>,
    resource_after: Vec<refral_core::ResourceOperation>,
}

fn reserve(bytes: &mut Vec<u8>, length: usize) -> bool {
    bytes.clear();
    if bytes.try_reserve_exact(length).is_err() {
        return false;
    }
    bytes.resize(length, 0);
    true
}

#[no_mangle]
pub extern "C" fn rf_command_prepare(metadata_length: f64, binary_length: f64) -> u32 {
    with_state(0, |state| {
        let transport = &mut state.render_transport;
        transport.prepared = false;
        transport.resource_before.clear();
        transport.resource_after.clear();
        if !metadata_length.is_finite()
            || metadata_length < 0.0
            || metadata_length.fract() != 0.0
            || metadata_length > MAX_METADATA_BYTES as f64
            || !binary_length.is_finite()
            || binary_length < 0.0
            || binary_length.fract() != 0.0
            || binary_length > u32::MAX as f64
        {
            state.core.record_error(INVALID_OPERATION);
            return 0;
        }
        // Reserve resource headers before any semantic state can change.
        transport.binary.clear();
        if transport
            .binary
            .try_reserve_exact(crate::resources::MAX_OPERATION_HEADERS)
            .is_err()
            || !reserve(&mut transport.metadata, metadata_length as usize)
            || !reserve(&mut transport.input, binary_length as usize)
        {
            state.core.record_error(OUT_OF_MEMORY);
            return 0;
        }
        transport.prepared = true;
        1
    })
}
#[no_mangle]
pub extern "C" fn rf_command_pointer() -> usize {
    with_state(0, |state| state.render_transport.metadata.as_ptr() as usize)
}
#[no_mangle]
pub extern "C" fn rf_command_binary_pointer() -> usize {
    with_state(0, |state| state.render_transport.input.as_ptr() as usize)
}
#[no_mangle]
pub extern "C" fn rf_reply_pointer() -> usize {
    with_state(0, |state| state.render_transport.output.as_ptr() as usize)
}
#[no_mangle]
pub extern "C" fn rf_reply_length() -> usize {
    with_state(0, |state| state.render_transport.output.len())
}
#[no_mangle]
pub extern "C" fn rf_reply_binary_pointer() -> usize {
    with_state(0, |state| state.render_transport.binary.as_ptr() as usize)
}
#[no_mangle]
pub extern "C" fn rf_reply_binary_length() -> usize {
    with_state(0, |state| state.render_transport.binary.len())
}

#[derive(Deserialize)]
struct Command {
    op: String,
    #[serde(default)]
    args: Vec<Value>,
    #[serde(default)]
    result: Value,
    #[serde(default)]
    request_id: u32,
}

fn parse_handle(value: &Value) -> Option<ObjectHandle> {
    let kind = match value.get("kind")?.as_str()? {
        "buffer" => ObjectKind::Buffer,
        "shader" => ObjectKind::Shader,
        "program" => ObjectKind::Program,
        "uniform-location" => ObjectKind::UniformLocation,
        "texture" => ObjectKind::Texture,
        "renderbuffer" => ObjectKind::Renderbuffer,
        "framebuffer" => ObjectKind::Framebuffer,
        "vertex-array" => ObjectKind::VertexArray,
        _ => return None,
    };
    Some(ObjectHandle {
        kind,
        context_id: u32::try_from(value.get("contextId")?.as_u64()?).ok()?,
        slot: u32::try_from(value.get("slot")?.as_u64()?).ok()?,
        generation: u32::try_from(value.get("generation")?.as_u64()?).ok()?,
    })
}
fn handle_json(handle: ObjectHandle) -> Value {
    json!({"kind":match handle.kind { ObjectKind::Buffer=>"buffer", ObjectKind::Shader=>"shader", ObjectKind::Program=>"program", ObjectKind::UniformLocation=>"uniform-location", ObjectKind::Texture=>"texture", ObjectKind::Renderbuffer=>"renderbuffer", ObjectKind::Framebuffer=>"framebuffer", ObjectKind::VertexArray=>"vertex-array" },"contextId":handle.context_id,"slot":handle.slot,"generation":handle.generation})
}
fn range<'a>(value: &Value, tag: &str, bytes: &'a [u8], width: usize) -> Option<&'a [u8]> {
    let values = value.get(tag)?.as_array()?;
    let offset = usize::try_from(values.first()?.as_u64()?).ok()?;
    let length = usize::try_from(values.get(1)?.as_u64()?)
        .ok()?
        .checked_mul(width)?;
    bytes.get(offset..offset.checked_add(length)?)
}
fn argument(value: &Value, bytes: &[u8], allocation_failed: &mut bool) -> Option<Argument> {
    if value.is_null() {
        return Some(Argument::Null);
    }
    if let Some(boolean) = value.as_bool() {
        return Some(Argument::Boolean(boolean));
    }
    if let Some(offset) = value.get("n").and_then(Value::as_u64) {
        let offset = usize::try_from(offset).ok()?;
        return Some(Argument::Number(f64::from_le_bytes(
            bytes.get(offset..offset.checked_add(8)?)?.try_into().ok()?,
        )));
    }
    if value.get("s").is_some() {
        return Some(Argument::Text(
            range(value, "s", bytes, 2)?
                .chunks_exact(2)
                .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
                .collect(),
        ));
    }
    if value.get("f").is_some() {
        return Some(Argument::Floats(
            range(value, "f", bytes, 4)?
                .chunks_exact(4)
                .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
                .collect(),
        ));
    }
    if value.get("i").is_some() {
        return Some(Argument::Ints(
            range(value, "i", bytes, 4)?
                .chunks_exact(4)
                .map(|bytes| i32::from_le_bytes(bytes.try_into().unwrap()))
                .collect(),
        ));
    }
    if value.get("p").is_some() {
        let converted = match value.get("source") {
            None => None,
            Some(Value::String(source)) if source == "dom" => Some(false),
            Some(Value::String(source)) if source == "dom-converted" => Some(true),
            _ => return None,
        };
        let input = range(value, "p", bytes, 1)?;
        let view = match value.get("viewType")?.as_str()? {
            "Uint8Array" | "Uint8ClampedArray" => PixelView::U8,
            "Uint16Array" => PixelView::U16,
            _ => PixelView::Other,
        };
        let mut data = Vec::new();
        if data.try_reserve_exact(input.len()).is_err() {
            *allocation_failed = true;
            return None;
        }
        data.extend_from_slice(input);
        return Some(match converted {
            Some(converted) => Argument::DomPixels {
                data,
                view,
                converted,
            },
            None => Argument::Pixels { data, view },
        });
    }
    parse_handle(value).map(Argument::Handle)
}
fn active(value: &Value) -> Option<ActiveInfo> {
    Some(ActiveInfo {
        name: value.get("name")?.as_str()?.to_owned(),
        size: u32::try_from(value.get("size")?.as_u64()?).ok()?,
        ty: u32::try_from(value.get("type")?.as_u64()?).ok()?,
    })
}
fn layout(value: &Value) -> Option<ProgramLayout> {
    let attributes = value
        .get("attributes")?
        .as_array()?
        .iter()
        .map(|value| {
            Some(AttributeInfo {
                active: active(value)?,
                location: u32::try_from(value.get("location")?.as_u64()?).ok()?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let uniforms = value
        .get("uniforms")?
        .as_array()?
        .iter()
        .map(|value| {
            Some(UniformInfo {
                active: active(value)?,
                vertex_offset: value
                    .get("vertexOffset")?
                    .as_u64()
                    .and_then(|value| usize::try_from(value).ok()),
                fragment_offset: value
                    .get("fragmentOffset")?
                    .as_u64()
                    .and_then(|value| usize::try_from(value).ok()),
                array_stride: usize::try_from(value.get("arrayStride")?.as_u64()?).ok()?,
                matrix_stride: usize::try_from(value.get("matrixStride")?.as_u64()?).ok()?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let samplers = value
        .get("samplers")?
        .as_array()?
        .iter()
        .map(active)
        .collect::<Option<Vec<_>>>()?;
    Some(ProgramLayout {
        attributes,
        uniforms,
        samplers,
        vertex_bytes: usize::try_from(value.get("vertexUniformBufferSize")?.as_u64()?).ok()?,
        fragment_bytes: usize::try_from(value.get("fragmentUniformBufferSize")?.as_u64()?).ok()?,
    })
}

fn initialize_drawing(core: &mut BufferCore, args: &[Argument]) {
    if let [Argument::Number(width), Argument::Number(height), Argument::Number(limit), ..] = args {
        core.configure_surface(*width as u32, *height as u32);
        core.configure_attribute_limit(*limit as usize);
    }
    if let Some(Argument::Number(units)) = args.get(3) {
        core.configure_texture_units(*units as usize);
    }
    if let Some(Argument::Number(limit)) = args.get(4) {
        core.configure_texture_dimension(*limit as u32);
    }
    if let [.., Argument::Boolean(alpha), Argument::Boolean(depth), Argument::Boolean(stencil)] =
        args
    {
        core.configure_context_attributes(*alpha, *depth, *stencil);
    }
}

#[no_mangle]
pub extern "C" fn rf_command_commit() -> u32 {
    with_state(0, |state| {
        let transport = &mut state.render_transport;
        transport.output.clear();
        transport.binary.clear();
        if !transport.prepared {
            return 0;
        }
        transport.prepared = false;
        let response = (|| {
            let command: Command = serde_json::from_slice(&transport.metadata).ok()?;
            let mut allocation_failed=false;
            let args = command.args.iter().map(|value|argument(value,&transport.input,&mut allocation_failed)).collect::<Option<Vec<_>>>();
            let Some(args)=args else {if allocation_failed {state.core.record_error(OUT_OF_MEMORY);return Some(json!({"type":"null"}));}return None;};
            let value = match command.op.as_str() {
                "initializeDrawing" => {
                    initialize_drawing(&mut state.core, &args);
                    Reply::Null
                }
                "prepareCompileShader" => {
                    state.core.prepare_compile(args.first().and_then(|arg| {
                        if let Argument::Handle(handle) = arg {
                            Some(*handle)
                        } else {
                            None
                        }
                    }))
                }
                "prepareLinkProgram" => state.core.prepare_link(args.first().and_then(|arg| {
                    if let Argument::Handle(handle) = arg {
                        Some(*handle)
                    } else {
                        None
                    }
                })),
                "commitCompileShader" => {
                    let handle = parse_handle(command.args.first()?)?;
                    let result = &command.result;
                    Reply::Boolean(state.core.commit_compile(
                        handle,
                        command.request_id,
                        CompileOutcome {
                            artifact_id: u32::try_from(result.get("artifactId")?.as_u64()?).ok()?,
                            success: result.get("success")?.as_bool()?,
                            log: result.get("log")?.as_str()?.to_owned(),
                        },
                    ))
                }
                "commitLinkProgram" => {
                    let handle = parse_handle(command.args.first()?)?;
                    let result = &command.result;
                    let success = result.get("success")?.as_bool()?;
                    Reply::Boolean(state.core.commit_link(
                        handle,
                        command.request_id,
                        LinkOutcome {
                            artifact_id: u32::try_from(result.get("artifactId")?.as_u64()?).ok()?,
                            success,
                            log: result.get("log")?.as_str()?.to_owned(),
                            layout: if success {
                                layout(result)?
                            } else {
                                ProgramLayout::default()
                            },
                        },
                    ))
                }
                _ => state.core.render_invoke(&command.op, &args),
            };
            let (before,after) = state.core.take_resource_operations();
            transport.resource_before=before;transport.resource_after=after;
            let before_length=crate::resources::capacity(&transport.resource_before)?;
            let after_length=crate::resources::capacity(&transport.resource_after)?;
            let capacity=reply_capacity(&value).and_then(|main|before_length.checked_add(main)).and_then(|value|value.checked_add(after_length));
            let Some(capacity)=capacity else{state.core.rollback_resource_writes(&transport.resource_after);transport.resource_after.clear();state.core.record_error(OUT_OF_MEMORY);return Some(json!({"type":"null"}));};
            if capacity>u32::MAX as usize || transport.binary.try_reserve_exact(capacity).is_err() {
                state.core.rollback_resource_writes(&transport.resource_after);
                transport.resource_after.clear();
                state.core.record_error(OUT_OF_MEMORY);
                return Some(json!({"type":"null"}));
            }
            crate::resources::encode(&mut transport.binary,&transport.resource_before);
            let main_start=transport.binary.len();
            let descriptor=reply(value,&mut transport.binary);
            let main_length=transport.binary.len()-main_start;
            crate::resources::encode(&mut transport.binary,&transport.resource_after);
            Some(json!({"value":descriptor,"beforeBytes":before_length,"mainBytes":main_length,"afterBytes":after_length}))
        })()
        .unwrap_or_else(|| json!({"type":"protocol-error"}));
        let releases = state.core.take_artifact_releases();
        let response = if response.get("value").is_some() {
            json!({"value":response["value"],"beforeBytes":response["beforeBytes"],"mainBytes":response["mainBytes"],"afterBytes":response["afterBytes"],"releases":releases})
        } else {
            json!({"value":response,"beforeBytes":0,"mainBytes":0,"afterBytes":0,"releases":releases})
        };
        match serde_json::to_vec(&response) {
            Ok(bytes) if bytes.len() <= MAX_METADATA_BYTES => {
                transport.output = bytes;
                1
            }
            _ => {
                state.core.record_error(OUT_OF_MEMORY);
                0
            }
        }
    })
}

pub(super) fn bytes(output: &mut Vec<u8>, data: &[u8]) {
    output.extend_from_slice(&(data.len() as u32).to_le_bytes());
    output.extend_from_slice(data);
}
pub(super) fn u32_value(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}
fn f32_value(output: &mut Vec<u8>, value: f32) {
    output.extend_from_slice(&value.to_le_bytes());
}
fn raster(output: &mut Vec<u8>, state: refral_core::RasterState) {
    for value in state.viewport {
        u32_value(output, value as u32);
    }
    for value in state.scissor {
        u32_value(output, value as u32);
    }
    u32_value(output, u32::from(state.scissor_test));
    u32_value(
        output,
        state
            .color_mask
            .iter()
            .enumerate()
            .fold(0, |mask, (index, value)| mask | u32::from(*value) << index),
    );
    u32_value(output, u32::from(state.depth_test));
    u32_value(output, u32::from(state.depth_mask));
    u32_value(output, state.depth_func);
    for value in state.depth_range {
        f32_value(output, value);
    }
    u32_value(output, u32::from(state.blend));
    for value in state.blend_color {
        f32_value(output, value);
    }
    for value in [
        state.blend_src_rgb,
        state.blend_dst_rgb,
        state.blend_src_alpha,
        state.blend_dst_alpha,
        state.blend_equation_rgb,
        state.blend_equation_alpha,
    ] {
        u32_value(output, value);
    }
    u32_value(output, u32::from(state.cull));
    u32_value(output, state.cull_face);
    u32_value(output, state.front_face);
    u32_value(output, u32::from(state.stencil_test));
    u32_value(output, state.stencil_clear as u32);
    for face in [state.stencil_front, state.stencil_back] {
        for value in [
            face.func,
            face.reference as u32,
            face.value_mask,
            face.write_mask,
            face.fail,
            face.depth_fail,
            face.pass,
        ] {
            u32_value(output, value);
        }
    }
}
fn buffer(output: &mut Vec<u8>, snapshot: &BufferSnapshot) {
    for value in [
        snapshot.metadata.handle.context_id,
        snapshot.metadata.handle.slot,
        snapshot.metadata.handle.generation,
    ] {
        u32_value(output, value);
    }
    output.extend_from_slice(&snapshot.metadata.storage_generation.to_le_bytes());
    output.extend_from_slice(&snapshot.metadata.content_version.to_le_bytes());
    bytes(output, &snapshot.data);
}
fn reply_capacity(value: &Reply) -> Option<usize> {
    match value {
        Reply::Number(_) => Some(8),
        Reply::Text(units) => units.len().checked_mul(2),
        Reply::Floats(values) => values.len().checked_mul(4),
        Reply::Ints(values) => values.len().checked_mul(4),
        Reply::Compile(request) => request.source.len().checked_mul(2),
        Reply::Target(target) => Some(crate::resources::target_capacity(target)),
        Reply::ReadPixelsPlan(plan) => Some(40 + crate::resources::target_capacity(&plan.target)),
        Reply::Clear(snapshot) => Some(204 + crate::resources::target_capacity(&snapshot.target)),
        Reply::Draw(snapshot) => {
            let mut total = 256_usize
                .checked_add(crate::resources::target_capacity(&snapshot.target))?
                .checked_add(snapshot.vertex_uniforms.len())?
                .checked_add(snapshot.fragment_uniforms.len())?;
            for attribute in &snapshot.attributes {
                total = total.checked_add(40)?;
                if let Some(buffer) = &attribute.data {
                    total = total.checked_add(32)?.checked_add(buffer.data.len())?;
                }
            }
            if let Some((buffer, _, _)) = &snapshot.indices {
                total = total.checked_add(40)?.checked_add(buffer.data.len())?;
            }
            for binding in &snapshot.textures {
                let versions = match &binding.images {
                    TextureImages::Texture2D(version) => usize::from(version.is_some()),
                    TextureImages::Cube(versions) => {
                        if versions.is_some() {
                            6
                        } else {
                            0
                        }
                    }
                    TextureImages::MipChain { images, .. } => images.len(),
                };
                total = total
                    .checked_add(24)?
                    .checked_add(versions * crate::resources::VERSION_BYTES)?;
            }
            Some(total)
        }
        _ => Some(0),
    }
}
fn reply(value: Reply, output: &mut Vec<u8>) -> Value {
    match value {
        Reply::Null => json!({"type":"null"}),
        Reply::Boolean(value) => json!({"type":"boolean","value":value}),
        Reply::Number(value) => {
            output.extend_from_slice(&value.to_le_bytes());
            json!({"type":"number"})
        }
        Reply::Handle(handle) => json!({"type":"handle","value":handle_json(handle)}),
        Reply::Handles(handles) => {
            json!({"type":"handles","value":handles.into_iter().map(handle_json).collect::<Vec<_>>()})
        }
        Reply::Text(units) => {
            for unit in units {
                output.extend_from_slice(&unit.to_le_bytes());
            }
            json!({"type":"text"})
        }
        Reply::Floats(values) => {
            for value in values {
                f32_value(output, value);
            }
            json!({"type":"floats"})
        }
        Reply::Ints(values) => {
            for value in values {
                output.extend_from_slice(&value.to_le_bytes());
            }
            json!({"type":"ints"})
        }
        Reply::Booleans(values) => json!({"type":"booleans","value":values}),
        Reply::Active(active) => {
            json!({"type":"active","value":{"name":active.name,"type":active.ty,"size":active.size}})
        }
        Reply::Precision(float) => {
            json!({"type":"object","value": if float {json!({"rangeMin":127,"rangeMax":127,"precision":23})} else {json!({"rangeMin":31,"rangeMax":30,"precision":0})}})
        }
        Reply::Compile(request) => {
            for unit in request.source {
                output.extend_from_slice(&unit.to_le_bytes());
            }
            json!({"type":"compile","requestId":request.request_id,"shader":handle_json(request.shader),"stage":request.stage})
        }
        Reply::Link(request) => {
            json!({"type":"link","requestId":request.request_id,"program":handle_json(request.program),"vertexArtifact":request.vertex_artifact,"fragmentArtifact":request.fragment_artifact,"bindings":request.bindings})
        }
        Reply::Unsupported(operation) => json!({"type":"unsupported","operation":operation}),
        Reply::Target(target) => {
            crate::resources::target(output, target);
            json!({"type":"target"})
        }
        Reply::ReadPixelsPlan(plan) => {
            crate::resources::target(output, plan.target);
            for value in [
                plan.source_x,
                plan.source_y,
                plan.copy_width,
                plan.copy_height,
            ] {
                u32_value(output, value);
            }
            for value in [
                plan.destination_offset,
                plan.destination_stride,
                plan.required_bytes,
            ] {
                output.extend_from_slice(&value.to_le_bytes());
            }
            json!({"type":"read-pixels"})
        }
        Reply::Clear(snapshot) => {
            crate::resources::target(output, snapshot.target);
            raster(output, snapshot.state);
            u32_value(output, snapshot.mask);
            for value in snapshot.color {
                f32_value(output, value);
            }
            f32_value(output, snapshot.depth);
            json!({"type":"clear"})
        }
        Reply::Draw(snapshot) => {
            u32_value(output, 0x36444652);
            u32_value(output, 6);
            u32_value(output, snapshot.artifact_id);
            for value in [
                snapshot.program.context_id,
                snapshot.program.slot,
                snapshot.program.generation,
            ] {
                u32_value(output, value);
            }
            output.extend_from_slice(&snapshot.link_generation.to_le_bytes());
            crate::resources::target(output, snapshot.target);
            raster(output, snapshot.state);
            u32_value(output, u32::from(snapshot.state.polygon_offset_fill));
            f32_value(output, snapshot.state.polygon_offset_factor);
            f32_value(output, snapshot.state.polygon_offset_units);
            for value in [
                snapshot.mode,
                snapshot.vertex_count,
                snapshot.first,
                snapshot.count,
                snapshot.attributes.len() as u32,
            ] {
                u32_value(output, value);
            }
            for attribute in snapshot.attributes {
                for value in [
                    attribute.location,
                    attribute.shader_type,
                    attribute.size,
                    attribute.ty,
                    u32::from(attribute.normalized),
                    attribute.stride,
                    attribute.offset as u32,
                ] {
                    u32_value(output, value);
                }
                for value in attribute.constant {
                    f32_value(output, value);
                }
                u32_value(output, u32::from(attribute.data.is_some()));
                if let Some(snapshot) = attribute.data {
                    buffer(output, &snapshot);
                }
            }
            u32_value(output, u32::from(snapshot.indices.is_some()));
            if let Some((snapshot, ty, offset)) = snapshot.indices {
                u32_value(output, ty);
                u32_value(output, offset as u32);
                buffer(output, &snapshot);
            }
            bytes(output, &snapshot.vertex_uniforms);
            bytes(output, &snapshot.fragment_uniforms);
            u32_value(output, snapshot.textures.len() as u32);
            for binding in snapshot.textures {
                match binding.images {
                    TextureImages::Texture2D(version) => {
                        u32_value(output, 0);
                        u32_value(output, u32::from(version.is_some()));
                        if let Some(version) = version {
                            crate::resources::version(output, version);
                        }
                    }
                    TextureImages::Cube(versions) => {
                        u32_value(output, 1);
                        u32_value(output, u32::from(versions.is_some()));
                        if let Some(versions) = versions {
                            for version in versions {
                                crate::resources::version(output, version);
                            }
                        }
                    }
                    TextureImages::MipChain {
                        cube,
                        levels,
                        images,
                    } => {
                        u32_value(output, u32::from(cube));
                        u32_value(output, levels as u32);
                        for version in images {
                            crate::resources::version(output, version);
                        }
                    }
                }
                crate::resources::parameters(output, binding.parameters);
            }
            json!({"type":"draw"})
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dom_pixel_descriptors_validate_source_markers_views_and_binary_ranges() {
        let bytes = [11, 77, 203, 0];
        let mut allocation_failed = false;
        for (marker, converted) in [("dom", false), ("dom-converted", true)] {
            let parsed = argument(
                &json!({"p":[0,4],"viewType":"Uint8ClampedArray","source":marker}),
                &bytes,
                &mut allocation_failed,
            );
            let Some(Argument::DomPixels {
                data,
                view,
                converted: actual,
            }) = parsed
            else {
                panic!()
            };
            assert_eq!(data, bytes);
            assert!(view == PixelView::U8);
            assert_eq!(actual, converted);
        }
        assert!(matches!(
            argument(
                &json!({"p":[0,4],"viewType":"Uint8Array"}),
                &bytes,
                &mut allocation_failed
            ),
            Some(Argument::Pixels {
                view: PixelView::U8,
                ..
            })
        ));
        assert!(matches!(
            argument(
                &json!({"p":[0,4],"viewType":"Uint16Array"}),
                &bytes,
                &mut allocation_failed
            ),
            Some(Argument::Pixels {
                view: PixelView::U16,
                ..
            })
        ));
        for invalid in [
            json!({"p":[0,4],"viewType":"Uint8Array","source":"unknown"}),
            json!({"p":[0,4],"viewType":"Uint8Array","source":null}),
            json!({"p":[1,4],"viewType":"Uint8Array","source":"dom"}),
            json!({"p":[-1,4],"viewType":"Uint8Array","source":"dom"}),
            json!({"p":[0,4],"viewType":[],"source":"dom"}),
        ] {
            assert!(argument(&invalid, &bytes, &mut allocation_failed).is_none());
        }
        assert!(!allocation_failed);
    }

    fn command(op: &str, args: Value, binary: &[u8]) -> Value {
        let metadata = serde_json::to_vec(&json!({"op":op,"args":args})).unwrap();
        assert_eq!(
            rf_command_prepare(metadata.len() as f64, binary.len() as f64),
            1
        );
        STATE.with(|state| {
            let mut state = state.borrow_mut();
            let transport = &mut state.as_mut().unwrap().render_transport;
            transport.metadata.copy_from_slice(&metadata);
            transport.input.copy_from_slice(binary);
        });
        assert_eq!(rf_command_commit(), 1);
        STATE.with(|state| {
            serde_json::from_slice(&state.borrow().as_ref().unwrap().render_transport.output)
                .unwrap()
        })
    }

    #[test]
    fn command_transport_preserves_utf16_and_owns_output() {
        assert_eq!(rf_resource_protocol_version(), 8);
        assert_eq!(rf_readback_protocol_version(), 1);
        assert_eq!(rf_dom_upload_protocol_version(), 2);
        assert_eq!(rf_init(7, 4096.0), 1);
        let stage = (refral_core::VERTEX_SHADER as f64).to_le_bytes();
        let created = command("createShader", json!([{"n":0}]), &stage);
        let handle = &created["value"]["value"];
        let units = [0xd800_u16, 0, 0xdc00, 0x4e2d];
        let bytes = units
            .into_iter()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();
        command(
            "shaderSource",
            json!([handle,{"s":[0,units.len()]}]),
            &bytes,
        );
        let queried = command("getShaderSource", json!([handle]), &[]);
        assert_eq!(queried["value"]["type"], "text");
        STATE.with(|state| {
            assert_eq!(
                &state.borrow().as_ref().unwrap().render_transport.binary[queried["beforeBytes"]
                    .as_u64()
                    .unwrap()
                    as usize
                    ..queried["beforeBytes"].as_u64().unwrap() as usize + bytes.len()],
                bytes.as_slice()
            )
        });
        let request = command("prepareCompileShader", json!([handle]), &[]);
        assert_eq!(request["value"]["type"], "compile");
        STATE.with(|state| {
            assert_eq!(
                &state.borrow().as_ref().unwrap().render_transport.binary[request["beforeBytes"]
                    .as_u64()
                    .unwrap()
                    as usize
                    ..request["beforeBytes"].as_u64().unwrap() as usize + bytes.len()],
                bytes.as_slice()
            )
        });
    }

    #[test]
    fn readback_reply_serializes_target_then_bounded_copy_plan() {
        let plan = refral_core::ReadPixelsPlan {
            target: refral_core::TargetSnapshot {
                width: 5,
                height: 3,
                is_default: true,
                color: None,
                color_texture_opaque: false,
                color_renderbuffer: None,
                depth: None,
            },
            source_x: 0,
            source_y: 1,
            copy_width: 5,
            copy_height: 2,
            destination_offset: 36,
            destination_stride: 32,
            required_bytes: 128,
        };
        assert_eq!(reply_capacity(&Reply::ReadPixelsPlan(plan)), Some(60));
        let mut output = Vec::new();
        assert_eq!(
            reply(Reply::ReadPixelsPlan(plan), &mut output),
            json!({"type":"read-pixels"})
        );
        assert_eq!(output.len(), 60);
        let values = output[..36]
            .chunks_exact(4)
            .map(|bytes| u32::from_le_bytes(bytes.try_into().unwrap()))
            .collect::<Vec<_>>();
        assert_eq!(values, [5, 3, 1, 0, 0, 0, 1, 5, 2]);
        let values = output[36..]
            .chunks_exact(8)
            .map(|bytes| u64::from_le_bytes(bytes.try_into().unwrap()))
            .collect::<Vec<_>>();
        assert_eq!(values, [36, 32, 128]);
    }

    #[test]
    fn malformed_binary_ranges_report_protocol_failure_without_trapping() {
        assert_eq!(rf_init(8, 4096.0), 1);
        for argument in [
            json!({"n":u64::MAX}),
            json!({"s":[4,1]}),
            json!({"f":[0,u64::MAX]}),
            json!({"p":[0,u64::MAX],"viewType":"Uint8Array"}),
        ] {
            let result = command("getParameter", json!([argument]), &[0; 4]);
            assert_eq!(result["value"]["type"], "protocol-error");
            assert_eq!(rf_get_error(), refral_core::NO_ERROR);
        }
        assert_ne!(rf_create_buffer(), 0);
        assert_eq!(rf_command_prepare(f64::NAN, 0.0), 0);
        assert_eq!(rf_get_error(), INVALID_OPERATION);
    }
}

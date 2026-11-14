use super::*;
use refral_core::{
    ActiveInfo, Argument, AttributeInfo, CompileOutcome, LinkOutcome, ObjectHandle, ObjectKind,
    ProgramLayout, Reply, UniformInfo,
};
use serde::Deserialize;
use serde_json::{json, Value};

const MAX_METADATA_BYTES: usize = 16 * 1024 * 1024;

#[derive(Default)]
pub(super) struct Transport {
    metadata: Vec<u8>,
    input: Vec<u8>,
    output: Vec<u8>,
    binary: Vec<u8>,
    prepared: bool,
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
        if !reserve(&mut transport.metadata, metadata_length as usize)
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
    json!({"kind":match handle.kind { ObjectKind::Buffer=>"buffer", ObjectKind::Shader=>"shader", ObjectKind::Program=>"program", ObjectKind::UniformLocation=>"uniform-location" },"contextId":handle.context_id,"slot":handle.slot,"generation":handle.generation})
}
fn range<'a>(value: &Value, tag: &str, bytes: &'a [u8], width: usize) -> Option<&'a [u8]> {
    let values = value.get(tag)?.as_array()?;
    let offset = usize::try_from(values.first()?.as_u64()?).ok()?;
    let length = usize::try_from(values.get(1)?.as_u64()?)
        .ok()?
        .checked_mul(width)?;
    bytes.get(offset..offset.checked_add(length)?)
}
fn argument(value: &Value, bytes: &[u8]) -> Option<Argument> {
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
            let args = command.args.iter().map(|value| argument(value, &transport.input)).collect::<Option<Vec<_>>>()?;
            let value = match command.op.as_str() {
                "initializeDrawing" => { if let [Argument::Number(width), Argument::Number(height), Argument::Number(limit)] = args.as_slice() { state.core.configure_surface(*width as u32,*height as u32); state.core.configure_attribute_limit(*limit as usize); } Reply::Null }
                "prepareCompileShader" => state.core.prepare_compile(args.first().and_then(|arg| if let Argument::Handle(handle)=arg {Some(*handle)}else{None})),
                "prepareLinkProgram" => state.core.prepare_link(args.first().and_then(|arg| if let Argument::Handle(handle)=arg {Some(*handle)}else{None})),
                "commitCompileShader" => {
                    let handle = parse_handle(command.args.first()?)?; let result = &command.result;
                    Reply::Boolean(state.core.commit_compile(handle, command.request_id, CompileOutcome { artifact_id: u32::try_from(result.get("artifactId")?.as_u64()?).ok()?, success: result.get("success")?.as_bool()?, log: result.get("log")?.as_str()?.to_owned() }))
                }
                "commitLinkProgram" => {
                    let handle = parse_handle(command.args.first()?)?; let result = &command.result;
                    let success = result.get("success")?.as_bool()?;
                    Reply::Boolean(state.core.commit_link(handle, command.request_id, LinkOutcome { artifact_id: u32::try_from(result.get("artifactId")?.as_u64()?).ok()?, success, log: result.get("log")?.as_str()?.to_owned(), layout: if success { layout(result)? } else { ProgramLayout::default() } }))
                }
                _ => state.core.render_invoke(&command.op, &args),
            };
            let capacity = reply_capacity(&value)?;
            if transport.binary.try_reserve_exact(capacity).is_err() {
                state.core.record_error(OUT_OF_MEMORY);
                return Some(json!({"type":"null"}));
            }
            Some(reply(value, &mut transport.binary))
        })().unwrap_or_else(|| json!({"type":"protocol-error"}));
        let releases = state.core.take_artifact_releases();
        let response = json!({"value":response,"releases":releases});
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

fn bytes(output: &mut Vec<u8>, data: &[u8]) {
    output.extend_from_slice(&(data.len() as u32).to_le_bytes());
    output.extend_from_slice(data);
}
fn u32_value(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}
fn f32_value(output: &mut Vec<u8>, value: f32) {
    output.extend_from_slice(&value.to_le_bytes());
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
        Reply::Compile(request) => request.source.len().checked_mul(2),
        Reply::Clear(_) => Some(48),
        Reply::Draw(snapshot) => {
            let mut total = 84_usize
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
        Reply::Clear(snapshot) => {
            for value in snapshot.surface {
                u32_value(output, value);
            }
            for value in snapshot.viewport {
                u32_value(output, value as u32);
            }
            u32_value(output, snapshot.mask);
            for value in snapshot.color {
                f32_value(output, value);
            }
            f32_value(output, snapshot.depth);
            json!({"type":"clear"})
        }
        Reply::Draw(snapshot) => {
            u32_value(output, 0x32444652);
            u32_value(output, 2);
            u32_value(output, snapshot.artifact_id);
            for value in [
                snapshot.program.context_id,
                snapshot.program.slot,
                snapshot.program.generation,
            ] {
                u32_value(output, value);
            }
            output.extend_from_slice(&snapshot.link_generation.to_le_bytes());
            for value in snapshot.surface {
                u32_value(output, value);
            }
            for value in snapshot.viewport {
                u32_value(output, value as u32);
            }
            for value in [
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
            json!({"type":"draw"})
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
                state.borrow().as_ref().unwrap().render_transport.binary,
                bytes
            )
        });
        let request = command("prepareCompileShader", json!([handle]), &[]);
        assert_eq!(request["value"]["type"], "compile");
        STATE.with(|state| {
            assert_eq!(
                state.borrow().as_ref().unwrap().render_transport.binary,
                bytes
            )
        });
    }

    #[test]
    fn malformed_binary_ranges_report_protocol_failure_without_trapping() {
        assert_eq!(rf_init(8, 4096.0), 1);
        for argument in [
            json!({"n":u64::MAX}),
            json!({"s":[4,1]}),
            json!({"f":[0,u64::MAX]}),
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

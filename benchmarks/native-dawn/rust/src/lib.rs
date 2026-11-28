//! Native semantic core for the closed Animometer fixture. C++ owns the Dawn device.
use refral_core::*;
use serde_json::Value;
use std::{
    ffi::{c_char, CStr},
    slice,
};

pub struct State {
    core: BufferCore,
    locations: Vec<ObjectHandle>,
}
fn num(x: u32) -> Argument {
    Argument::Number(x.into())
}
fn string(s: &str) -> Argument {
    Argument::Text(s.encode_utf16().collect())
}
fn handle(r: Reply) -> Option<ObjectHandle> {
    if let Reply::Handle(h) = r {
        Some(h)
    } else {
        None
    }
}
fn setup(c: Value) -> Option<State> {
    let mut core = BufferCore::new(1, 64 << 20).ok()?;
    core.render_invoke("setSurfaceSize", &[num(800), num(600)]);
    core.render_invoke("viewport", &[num(0), num(0), num(800), num(600)]);
    let program = handle(core.render_invoke("createProgram", &[]))?;
    for (i, (key, ty)) in [("vs", 0x8b31), ("fs", 0x8b30)].into_iter().enumerate() {
        let h = handle(core.render_invoke("createShader", &[num(ty)]))?;
        core.render_invoke(
            "shaderSource",
            &[Argument::Handle(h), string(c[key].as_str()?)],
        );
        let Reply::Compile(req) = core.prepare_compile(Some(h)) else {
            return None;
        };
        if !core.commit_compile(
            h,
            req.request_id,
            CompileOutcome {
                artifact_id: i as u32 + 1,
                success: true,
                log: String::new(),
            },
        ) {
            return None;
        }
        core.render_invoke(
            "attachShader",
            &[Argument::Handle(program), Argument::Handle(h)],
        );
    }
    let linked = &c["linked"];
    let mut layout = ProgramLayout {
        vertex_bytes: linked["vertexUniformBufferSize"].as_u64()? as usize,
        fragment_bytes: linked["fragmentUniformBufferSize"].as_u64()? as usize,
        ..Default::default()
    };
    let active = |v: &Value| {
        Some(ActiveInfo {
            name: v["name"].as_str()?.into(),
            size: v["size"].as_u64()? as u32,
            ty: v["type"].as_u64()? as u32,
        })
    };
    for a in linked["attributes"].as_array()? {
        layout.attributes.push(AttributeInfo {
            active: active(a)?,
            location: a["location"].as_u64()? as u32,
        });
    }
    for u in linked["uniforms"].as_array()? {
        layout.uniforms.push(UniformInfo {
            active: active(u)?,
            vertex_offset: u["vertexOffset"].as_u64().map(|x| x as usize),
            fragment_offset: u["fragmentOffset"].as_u64().map(|x| x as usize),
            array_stride: u["arrayStride"].as_u64()? as usize,
            matrix_stride: u["matrixStride"].as_u64()? as usize,
        });
    }
    let Reply::Link(req) = core.prepare_link(Some(program)) else {
        return None;
    };
    if !core.commit_link(
        program,
        req.request_id,
        LinkOutcome {
            artifact_id: 3,
            success: true,
            log: String::new(),
            layout,
        },
    ) {
        return None;
    }
    core.render_invoke("useProgram", &[Argument::Handle(program)]);
    let mut locations = Vec::new();
    for u in linked["uniforms"].as_array()? {
        locations.push(handle(core.render_invoke(
            "getUniformLocation",
            &[Argument::Handle(program), string(u["name"].as_str()?)],
        ))?);
    }
    for (i, attrib) in c["streams"].as_array()?.iter().enumerate() {
        let b = core.create_buffer()?;
        core.bind_buffer(ARRAY_BUFFER, Some(b));
        let mut bytes = Vec::new();
        for x in attrib.as_array()? {
            bytes.extend((x.as_f64()? as f32).to_le_bytes());
        }
        core.buffer_data_bytes(ARRAY_BUFFER, &bytes, STATIC_DRAW);
        core.render_invoke(
            "vertexAttribPointer",
            &[
                num(i as u32),
                num(4),
                num(FLOAT),
                Argument::Boolean(false),
                num(0),
                num(0),
            ],
        );
        core.render_invoke("enableVertexAttribArray", &[num(i as u32)]);
    }
    core.render_invoke(
        "clearColor",
        &[
            Argument::Number(0.5),
            Argument::Number(0.5),
            Argument::Number(0.5),
            num(1),
        ],
    );
    (core.get_error() == 0).then_some(State { core, locations })
}
/// # Safety
/// The caller owns a valid NUL-terminated UTF-8 config for this call.
#[no_mangle]
pub unsafe extern "C" fn rf_new(config: *const c_char) -> *mut State {
    CStr::from_ptr(config)
        .to_str()
        .ok()
        .and_then(|s| serde_json::from_str(s).ok())
        .and_then(setup)
        .map_or(std::ptr::null_mut(), |s| Box::into_raw(Box::new(s)))
}
#[no_mangle]
pub extern "C" fn rf_uniform(state: &mut State, slot: u32, value: f32) {
    state.core.render_invoke(
        "uniform1f",
        &[
            Argument::Handle(state.locations[slot as usize]),
            Argument::Number(value.into()),
        ],
    );
}
/// # Safety
/// The host provides an exclusive writable region of at least capacity bytes.
#[no_mangle]
pub unsafe extern "C" fn rf_draw(
    state: &mut State,
    mode: u32,
    first: i32,
    count: i32,
    out: *mut u8,
    capacity: usize,
) -> bool {
    let Reply::Draw(draw) = state.core.render_invoke(
        "drawArrays",
        &[
            num(mode),
            Argument::Number(first.into()),
            Argument::Number(count.into()),
        ],
    ) else {
        return false;
    };
    if draw.vertex_uniforms.len() > capacity || draw.attributes.len() != 2 || draw.artifact_id != 3
    {
        return false;
    }
    slice::from_raw_parts_mut(out, draw.vertex_uniforms.len())
        .copy_from_slice(&draw.vertex_uniforms);
    true
}
#[no_mangle]
pub extern "C" fn rf_clear(state: &mut State) -> bool {
    matches!(
        state.core.render_invoke("clear", &[num(0x4000)]),
        Reply::Clear(_)
    )
}
/// # Safety
/// The pointer comes from rf_new and is released exactly once.
#[no_mangle]
pub unsafe extern "C" fn rf_drop(s: *mut State) {
    drop(Box::from_raw(s));
}

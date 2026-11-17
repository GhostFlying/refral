use super::*;

#[test]
fn retained_shader_and_program_names_survive_until_final_retirement() {
    let (mut core, program, vertex, _fragment, old_location, _buffer) = scene();
    core.render_invoke("deleteShader", &[h(vertex)]);
    core.render_invoke("shaderSource", &[h(vertex), s("replacement source")]);
    compile(&mut core, vertex, 4);
    assert!(matches!(
        core.render_invoke("getShaderSource", &[h(vertex)]),
        Reply::Text(_)
    ));
    assert_eq!(core.get_error(), NO_ERROR);

    core.render_invoke("deleteProgram", &[h(program)]);
    link(&mut core, program, 5, true);
    let location = handle(core.render_invoke("getUniformLocation", &[h(program), s("u_color")]));
    core.render_invoke("getUniform", &[h(program), h(old_location)]);
    assert_eq!(core.get_error(), INVALID_OPERATION);
    assert!(matches!(
        core.render_invoke("getUniform", &[h(program), h(location)]),
        Reply::Floats(_)
    ));
    assert_eq!(core.get_error(), NO_ERROR);
    core.render_invoke("useProgram", &[h(program)]);
    assert_eq!(core.get_error(), INVALID_OPERATION);
    assert!(matches!(
        core.render_invoke("drawArrays", &[n(TRIANGLES as f64), n(0.0), n(3.0)]),
        Reply::Draw(_)
    ));

    core.render_invoke("detachShader", &[h(program), h(vertex)]);
    assert!(matches!(
        core.render_invoke("getShaderParameter", &[h(vertex), n(0x8b80 as f64)]),
        Reply::Null
    ));
    assert_eq!(core.get_error(), INVALID_VALUE);
    core.render_invoke("useProgram", &[Argument::Null]);
    assert!(matches!(
        core.render_invoke("getProgramParameter", &[h(program), n(0x8b80 as f64)]),
        Reply::Null
    ));
    assert_eq!(core.get_error(), INVALID_VALUE);
    assert!(matches!(
        core.render_invoke("getUniformLocation", &[h(program), s("u_color")]),
        Reply::Null
    ));
    assert_eq!(core.get_error(), INVALID_VALUE);
    core.render_invoke("useProgram", &[h(program)]);
    assert_eq!(core.get_error(), INVALID_OPERATION);
}

fn n(value: f64) -> Argument {
    Argument::Number(value)
}
fn h(value: ObjectHandle) -> Argument {
    Argument::Handle(value)
}
fn s(value: &str) -> Argument {
    Argument::Text(value.encode_utf16().collect())
}
fn handle(reply: Reply) -> ObjectHandle {
    if let Reply::Handle(handle) = reply {
        handle
    } else {
        panic!("expected handle")
    }
}
fn compile(core: &mut ContextCore, shader: ObjectHandle, id: u32) {
    let Reply::Compile(request) = core.prepare_compile(Some(shader)) else {
        panic!("expected request")
    };
    assert!(core.commit_compile(
        shader,
        request.request_id,
        CompileOutcome {
            artifact_id: id,
            success: true,
            log: String::new()
        }
    ));
}
fn layout() -> ProgramLayout {
    ProgramLayout {
        attributes: vec![AttributeInfo {
            active: ActiveInfo {
                name: "a_position".into(),
                size: 1,
                ty: FLOAT_VEC2,
            },
            location: 0,
        }],
        uniforms: vec![UniformInfo {
            active: ActiveInfo {
                name: "u_color".into(),
                size: 1,
                ty: FLOAT_VEC4,
            },
            vertex_offset: None,
            fragment_offset: Some(0),
            array_stride: 0,
            matrix_stride: 0,
        }],
        vertex_bytes: 0,
        fragment_bytes: 16,
        samplers: vec![],
    }
}
fn link(core: &mut ContextCore, program: ObjectHandle, id: u32, success: bool) {
    let Reply::Link(request) = core.prepare_link(Some(program)) else {
        panic!("expected request")
    };
    assert!(core.commit_link(
        program,
        request.request_id,
        LinkOutcome {
            artifact_id: id,
            success,
            log: if success {
                String::new()
            } else {
                "link failed".into()
            },
            layout: layout()
        }
    ));
}
pub(crate) fn scene() -> (
    ContextCore,
    ObjectHandle,
    ObjectHandle,
    ObjectHandle,
    ObjectHandle,
    BufferHandle,
) {
    let mut core = ContextCore::new(1, 1024 * 1024).unwrap();
    core.configure_surface(16, 16);
    let vertex = handle(core.render_invoke("createShader", &[n(VERTEX_SHADER as f64)]));
    let fragment = handle(core.render_invoke("createShader", &[n(FRAGMENT_SHADER as f64)]));
    compile(&mut core, vertex, 1);
    compile(&mut core, fragment, 2);
    let program = handle(core.render_invoke("createProgram", &[]));
    core.render_invoke("attachShader", &[h(program), h(vertex)]);
    core.render_invoke("attachShader", &[h(program), h(fragment)]);
    link(&mut core, program, 3, true);
    core.render_invoke("useProgram", &[h(program)]);
    let location = handle(core.render_invoke("getUniformLocation", &[h(program), s("u_color")]));
    let buffer = core.create_buffer().unwrap();
    core.bind_buffer(ARRAY_BUFFER, Some(buffer));
    core.buffer_data_bytes(ARRAY_BUFFER, &[0; 24], STATIC_DRAW);
    core.render_invoke(
        "vertexAttribPointer",
        &[
            n(0.0),
            n(2.0),
            n(FLOAT as f64),
            Argument::Boolean(false),
            n(0.0),
            n(0.0),
        ],
    );
    core.render_invoke("enableVertexAttribArray", &[n(0.0)]);
    (core, program, vertex, fragment, location, buffer)
}
fn draw(core: &mut ContextCore) -> DrawSnapshot {
    let Reply::Draw(snapshot) = core.render_invoke("drawArrays", &[n(4.0), n(0.0), n(3.0)]) else {
        panic!("expected draw, error {}", core.get_error())
    };
    snapshot
}

#[test]
fn utf16_source_roundtrips_surrogates_nul_and_preserves_kind_ownership() {
    let mut core = ContextCore::new(1, 1024).unwrap();
    let shader = handle(core.render_invoke("createShader", &[n(VERTEX_SHADER as f64)]));
    let units = vec![0xd800, 0, 0xdc00, 0x4e2d];
    core.render_invoke("shaderSource", &[h(shader), Argument::Text(units.clone())]);
    let Reply::Text(source) = core.render_invoke("getShaderSource", &[h(shader)]) else {
        panic!()
    };
    assert_eq!(source, units);
    let Reply::Compile(request) = core.prepare_compile(Some(shader)) else {
        panic!()
    };
    assert_eq!(request.source, units);
    let buffer: ObjectHandle = core.create_buffer().unwrap().into();
    core.render_invoke("shaderSource", &[h(buffer), s("bad")]);
    assert_eq!(core.get_error(), INVALID_OPERATION);
    assert!(matches!(
        core.render_invoke("getShaderSource", &[h(shader)]),
        Reply::Text(_)
    ));
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn installed_executable_survives_source_compile_and_attachment_changes_until_link() {
    let (mut core, program, vertex, fragment, location, _) = scene();
    core.render_invoke(
        "uniform4fv",
        &[h(location), Argument::Floats(vec![1.0, 0.0, 0.0, 1.0])],
    );
    core.render_invoke("shaderSource", &[h(fragment), s("different")]);
    compile(&mut core, fragment, 4);
    core.render_invoke("detachShader", &[h(program), h(vertex)]);
    core.render_invoke("deleteShader", &[h(vertex)]);
    let snapshot = draw(&mut core);
    assert_eq!(snapshot.artifact_id, 3);
    assert_eq!(&snapshot.fragment_uniforms[0..4], &1.0_f32.to_le_bytes());
    link(&mut core, program, 0, false);
    assert!(matches!(
        core.render_invoke("drawArrays", &[n(4.0), n(0.0), n(3.0)]),
        Reply::Null
    ));
    assert_eq!(core.get_error(), INVALID_OPERATION);
    core.render_invoke("uniform4f", &[h(location), n(0.0), n(1.0), n(0.0), n(1.0)]);
    assert_eq!(core.get_error(), INVALID_OPERATION);
    link(&mut core, program, 5, true);
    core.render_invoke("uniform4f", &[h(location), n(0.0), n(1.0), n(0.0), n(1.0)]);
    assert_eq!(core.get_error(), INVALID_OPERATION);
    let fresh = handle(core.render_invoke("getUniformLocation", &[h(program), s("u_color")]));
    let Reply::Floats(values) = core.render_invoke("getUniform", &[h(program), h(fresh)]) else {
        panic!()
    };
    assert_eq!(values, vec![0.0; 4]);
}

#[test]
fn uniform_snapshots_own_values_and_preserve_unrestricted_floats() {
    let (mut core, program, _, _, location, _) = scene();
    core.render_invoke(
        "uniform4f",
        &[
            h(location),
            n(f64::NAN),
            n(f64::INFINITY),
            n(f64::NEG_INFINITY),
            n(1.0),
        ],
    );
    let Reply::Floats(values) = core.render_invoke("getUniform", &[h(program), h(location)]) else {
        panic!()
    };
    assert!(values[0].is_nan());
    assert_eq!(values[1], f32::INFINITY);
    assert_eq!(values[2], f32::NEG_INFINITY);
    let before = draw(&mut core);
    core.render_invoke(
        "uniform4fv",
        &[h(location), Argument::Floats(vec![0.0, 1.0, 0.0, 1.0])],
    );
    assert!(f32::from_le_bytes(before.fragment_uniforms[0..4].try_into().unwrap()).is_nan());
    core.render_invoke(
        "uniform4fv",
        &[h(location), Argument::Floats(vec![1.0, 2.0, 3.0])],
    );
    assert_eq!(core.get_error(), INVALID_VALUE);
    core.render_invoke("uniform3f", &[h(location), n(1.0), n(2.0), n(3.0)]);
    assert_eq!(core.get_error(), INVALID_OPERATION);
}

#[test]
fn every_null_uniform_setter_is_neutral_without_a_current_program() {
    let mut core = ContextCore::new(1, 1024).unwrap();
    for operation in [
        "uniform1f",
        "uniform2f",
        "uniform3f",
        "uniform4f",
        "uniform1fv",
        "uniform2fv",
        "uniform3fv",
        "uniform4fv",
        "uniform1i",
        "uniform2i",
        "uniform3i",
        "uniform4i",
        "uniform1iv",
        "uniform2iv",
        "uniform3iv",
        "uniform4iv",
        "uniformMatrix2fv",
        "uniformMatrix3fv",
        "uniformMatrix4fv",
    ] {
        assert!(matches!(
            core.render_invoke(operation, &[Argument::Null, Argument::Floats(vec![1.0])]),
            Reply::Null
        ));
        assert_eq!(core.get_error(), NO_ERROR);
    }
}

#[test]
fn buffers_and_draws_share_storage_versions_and_owned_snapshots() {
    let (mut core, _, _, _, _, buffer) = scene();
    let before = draw(&mut core);
    core.buffer_sub_data(ARRAY_BUFFER, 0.0, &[9, 8, 7, 6]);
    let after = draw(&mut core);
    assert_eq!(
        &before.attributes[0].data.as_ref().unwrap().data[..4],
        &[0; 4]
    );
    assert_eq!(
        &after.attributes[0].data.as_ref().unwrap().data[..4],
        &[9, 8, 7, 6]
    );
    assert_eq!(
        after.attributes[0]
            .data
            .as_ref()
            .unwrap()
            .metadata
            .content_version,
        2
    );
    core.delete_buffer(Some(buffer));
    assert!(matches!(
        core.render_invoke("drawArrays", &[n(4.0), n(0.0), n(3.0)]),
        Reply::Null
    ));
    assert_eq!(core.get_error(), INVALID_OPERATION);
    assert_eq!(before.attributes[0].data.as_ref().unwrap().data.len(), 24);
}

#[test]
fn indexed_draw_checks_u8_u16_alignment_ranges_and_attribute_bounds() {
    let (mut core, _, _, _, _, _) = scene();
    let index = core.create_buffer().unwrap();
    core.bind_buffer(ELEMENT_ARRAY_BUFFER, Some(index));
    core.buffer_data_bytes(ELEMENT_ARRAY_BUFFER, &[0, 1, 2], STATIC_DRAW);
    let Reply::Draw(snapshot) =
        core.render_invoke("drawElements", &[n(4.0), n(3.0), n(0x1401 as f64), n(0.0)])
    else {
        panic!()
    };
    assert_eq!(snapshot.vertex_count, 3);
    core.buffer_data_bytes(ELEMENT_ARRAY_BUFFER, &[0, 0, 1, 0, 2, 0], STATIC_DRAW);
    assert!(matches!(
        core.render_invoke("drawElements", &[n(4.0), n(3.0), n(0x1403 as f64), n(0.0)]),
        Reply::Draw(_)
    ));
    for (count, offset) in [(3.0, 1.0), (4.0, 0.0)] {
        core.render_invoke(
            "drawElements",
            &[n(4.0), n(count), n(0x1403 as f64), n(offset)],
        );
        assert_eq!(core.get_error(), INVALID_OPERATION);
    }
    core.buffer_sub_data(ELEMENT_ARRAY_BUFFER, 4.0, &[3, 0]);
    core.render_invoke("drawElements", &[n(4.0), n(3.0), n(0x1403 as f64), n(0.0)]);
    assert_eq!(core.get_error(), INVALID_OPERATION);
}

#[test]
fn deletion_retains_attached_shader_and_current_program_until_references_release() {
    let (mut core, program, vertex, _, _, _) = scene();
    core.render_invoke("deleteShader", &[h(vertex)]);
    assert!(matches!(
        core.render_invoke("isShader", &[h(vertex)]),
        Reply::Boolean(true)
    ));
    core.render_invoke("deleteProgram", &[h(program)]);
    assert!(matches!(
        core.render_invoke("isProgram", &[h(program)]),
        Reply::Boolean(true)
    ));
    assert_eq!(draw(&mut core).artifact_id, 3);
    core.render_invoke("useProgram", &[Argument::Null]);
    assert!(matches!(
        core.render_invoke("isProgram", &[h(program)]),
        Reply::Boolean(false)
    ));
    assert!(matches!(
        core.render_invoke("isShader", &[h(vertex)]),
        Reply::Boolean(false)
    ));
    let releases = core.take_artifact_releases();
    assert!(releases.contains(&1));
    assert!(releases.contains(&3));
}

#[test]
fn stale_compile_commit_and_foreign_programs_cannot_change_state() {
    let (mut core, program, vertex, _, _, _) = scene();
    let Reply::Compile(request) = core.prepare_compile(Some(vertex)) else {
        panic!()
    };
    core.render_invoke("shaderSource", &[h(vertex), s("changed")]);
    assert!(!core.commit_compile(
        vertex,
        request.request_id,
        CompileOutcome {
            artifact_id: 9,
            success: true,
            log: String::new()
        }
    ));
    core.render_invoke(
        "useProgram",
        &[h(ObjectHandle {
            context_id: 2,
            ..program
        })],
    );
    assert_eq!(core.get_error(), INVALID_OPERATION);
    assert_eq!(draw(&mut core).artifact_id, 3);
    core.mark_lost();
    assert_eq!(core.get_error(), CONTEXT_LOST_WEBGL);
    assert!(matches!(
        core.render_invoke("createProgram", &[]),
        Reply::Null
    ));
    core.render_invoke("uniform4f", &[h(program)]);
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn attribute_vector_length_and_null_buffer_pointer_follow_webgl_rules() {
    let (mut core, _, _, _, _, _) = scene();
    core.render_invoke("vertexAttrib4f", &[n(0.0), n(1.0), n(2.0), n(3.0), n(4.0)]);
    core.render_invoke(
        "vertexAttrib4fv",
        &[n(0.0), Argument::Floats(vec![9.0, 8.0, 7.0])],
    );
    assert_eq!(core.get_error(), INVALID_VALUE);
    let Reply::Floats(values) = core.render_invoke("getVertexAttrib", &[n(0.0), n(0x8626 as f64)])
    else {
        panic!()
    };
    assert_eq!(values, [1.0, 2.0, 3.0, 4.0]);
    core.bind_buffer(ARRAY_BUFFER, None);
    core.render_invoke(
        "vertexAttribPointer",
        &[
            n(0.0),
            n(2.0),
            n(FLOAT as f64),
            Argument::Boolean(false),
            n(0.0),
            n(0.0),
        ],
    );
    assert_eq!(core.get_error(), NO_ERROR);
    assert!(matches!(
        core.render_invoke("getVertexAttrib", &[n(0.0), n(0x889f as f64)]),
        Reply::Null
    ));
    core.render_invoke(
        "vertexAttribPointer",
        &[
            n(0.0),
            n(2.0),
            n(FLOAT as f64),
            Argument::Boolean(false),
            n(0.0),
            n(4.0),
        ],
    );
    assert_eq!(core.get_error(), INVALID_OPERATION);
}

fn install_layout(core: &mut ContextCore, program: ObjectHandle, layout: ProgramLayout) {
    let Reply::Link(request) = core.prepare_link(Some(program)) else {
        panic!()
    };
    assert!(core.commit_link(
        program,
        request.request_id,
        LinkOutcome {
            artifact_id: 100,
            success: true,
            log: String::new(),
            layout
        }
    ));
}
fn uniform_info(
    name: &str,
    ty: u32,
    size: u32,
    offset: usize,
    array_stride: usize,
    matrix_stride: usize,
) -> UniformInfo {
    UniformInfo {
        active: ActiveInfo {
            name: name.into(),
            ty,
            size,
        },
        vertex_offset: Some(offset),
        fragment_offset: Some(offset),
        array_stride,
        matrix_stride,
    }
}

#[test]
fn typed_uniforms_preserve_i32_bool_matrix_array_values_and_padding() {
    let (mut core, program, _, _, _, _) = scene();
    let mut layout = layout();
    layout.uniforms = vec![
        uniform_info("u_int", 0x8b55, 1, 0, 0, 0),
        uniform_info("u_bool", 0x8b58, 1, 16, 0, 0),
        uniform_info("u_matrix[0]", 0x8b5b, 2, 32, 48, 16),
        uniform_info("u_array[0]", FLOAT_VEC2, 3, 128, 16, 0),
        uniform_info("u_float", FLOAT, 1, 176, 0, 0),
        uniform_info("u_single_array", FLOAT, 1, 180, 16, 0),
    ];
    layout.vertex_bytes = 192;
    layout.fragment_bytes = 192;
    install_layout(&mut core, program, layout);
    let int = handle(core.render_invoke("getUniformLocation", &[h(program), s("u_int")]));
    let integers = vec![i32::MAX, i32::MIN, 16_777_217, -16_777_217];
    core.render_invoke("uniform4iv", &[h(int), Argument::Ints(integers.clone())]);
    let Reply::Ints(values) = core.render_invoke("getUniform", &[h(program), h(int)]) else {
        panic!()
    };
    assert_eq!(values, integers);
    let boolean = handle(core.render_invoke("getUniformLocation", &[h(program), s("u_bool")]));
    core.render_invoke(
        "uniform3fv",
        &[h(boolean), Argument::Floats(vec![-0.0, f32::NAN, -1.0])],
    );
    let Reply::Booleans(values) = core.render_invoke("getUniform", &[h(program), h(boolean)])
    else {
        panic!()
    };
    assert_eq!(values, [false, true, true]);
    let matrix = handle(core.render_invoke("getUniformLocation", &[h(program), s("u_matrix")]));
    core.render_invoke(
        "uniformMatrix3fv",
        &[
            h(matrix),
            Argument::Boolean(false),
            Argument::Floats((1..=18).map(|value| value as f32).collect()),
        ],
    );
    let matrix_second =
        handle(core.render_invoke("getUniformLocation", &[h(program), s("u_matrix[1]")]));
    let Reply::Floats(values) = core.render_invoke("getUniform", &[h(program), h(matrix_second)])
    else {
        panic!()
    };
    assert_eq!(
        values,
        (10..=18).map(|value| value as f32).collect::<Vec<_>>()
    );
    let array = handle(core.render_invoke("getUniformLocation", &[h(program), s("u_array")]));
    core.render_invoke(
        "uniform2fv",
        &[
            h(array),
            Argument::Floats((1..=10).map(|value| value as f32).collect()),
        ],
    );
    assert_eq!(core.get_error(), NO_ERROR);
    let single_array =
        handle(core.render_invoke("getUniformLocation", &[h(program), s("u_single_array")]));
    core.render_invoke(
        "uniform1fv",
        &[h(single_array), Argument::Floats(vec![4.0, 5.0, 6.0])],
    );
    assert_eq!(core.get_error(), NO_ERROR);
    assert!(matches!(
        core.render_invoke("getUniform", &[h(program), h(single_array)]),
        Reply::Number(4.0)
    ));
    let Reply::Active(active) = core.render_invoke("getActiveUniform", &[h(program), n(5.0)])
    else {
        panic!()
    };
    assert_eq!(active.name, "u_single_array[0]");
    let snapshot = draw(&mut core);
    let bytes = &snapshot.vertex_uniforms;
    assert_eq!(
        i32::from_le_bytes(bytes[0..4].try_into().unwrap()),
        i32::MAX
    );
    assert_eq!(
        i32::from_le_bytes(bytes[8..12].try_into().unwrap()),
        16_777_217
    );
    assert_eq!(f32::from_le_bytes(bytes[32..36].try_into().unwrap()), 1.0);
    assert_eq!(f32::from_le_bytes(bytes[48..52].try_into().unwrap()), 4.0);
    assert_eq!(&bytes[44..48], &[0; 4]);
    assert_eq!(f32::from_le_bytes(bytes[80..84].try_into().unwrap()), 10.0);
    assert_eq!(f32::from_le_bytes(bytes[160..164].try_into().unwrap()), 5.0);
    assert_eq!(&bytes[176..180], &[0; 4]);
    core.render_invoke(
        "uniformMatrix3fv",
        &[
            h(matrix),
            Argument::Boolean(true),
            Argument::Floats(vec![0.0; 9]),
        ],
    );
    assert_eq!(core.get_error(), INVALID_VALUE);
    core.render_invoke("uniform4fv", &[h(int), Argument::Floats(vec![1.0; 4])]);
    assert_eq!(core.get_error(), INVALID_OPERATION);
    core.render_invoke("useProgram", &[Argument::Null]);
    let Reply::Ints(values) = core.render_invoke("getUniform", &[h(program), h(int)]) else {
        panic!()
    };
    assert_eq!(values, integers);
}

#[test]
fn scalar_sampler_units_and_scalar_boolean_getters_use_declared_types() {
    let (mut core, program, _, _, _, _) = scene();
    let mut layout = layout();
    layout.uniforms = vec![uniform_info("u_boolean", 0x8b56, 1, 0, 0, 0)];
    layout.vertex_bytes = 16;
    layout.fragment_bytes = 16;
    layout.samplers = vec![ActiveInfo {
        name: "u_texture".into(),
        ty: 0x8b5e,
        size: 1,
    }];
    install_layout(&mut core, program, layout);
    let boolean = handle(core.render_invoke("getUniformLocation", &[h(program), s("u_boolean")]));
    core.render_invoke("uniform1f", &[h(boolean), n(f64::NAN)]);
    assert!(matches!(
        core.render_invoke("getUniform", &[h(program), h(boolean)]),
        Reply::Boolean(true)
    ));
    let sampler = handle(core.render_invoke("getUniformLocation", &[h(program), s("u_texture")]));
    core.render_invoke("uniform1i", &[h(sampler), n(7.0)]);
    assert!(matches!(
        core.render_invoke("getUniform", &[h(program), h(sampler)]),
        Reply::Number(7.0)
    ));
    core.render_invoke("uniform1iv", &[h(sampler), Argument::Ints(vec![8])]);
    assert_eq!(core.get_error(), INVALID_VALUE);
    core.render_invoke("uniform1f", &[h(sampler), n(1.0)]);
    assert_eq!(core.get_error(), INVALID_OPERATION);
    assert!(matches!(
        core.render_invoke("getUniform", &[h(program), h(sampler)]),
        Reply::Number(7.0)
    ));
}

#[test]
fn raster_snapshots_preserve_state_and_failed_calls_are_atomic() {
    let (mut core, _, _, _, _, _) = scene();
    for cap in [0x0be2, 0x0b44, 0x0b71, 0x0c11] {
        core.render_invoke("enable", &[n(cap as f64)]);
    }
    core.render_invoke("scissor", &[n(-1.0), n(2.0), n(8.0), n(9.0)]);
    core.render_invoke(
        "colorMask",
        &[
            Argument::Boolean(true),
            Argument::Boolean(false),
            Argument::Boolean(true),
            Argument::Boolean(false),
        ],
    );
    core.render_invoke("depthRange", &[n(-1.0), n(2.0)]);
    core.render_invoke("depthFunc", &[n(0x203 as f64)]);
    core.render_invoke("depthMask", &[Argument::Boolean(false)]);
    core.render_invoke("frontFace", &[n(0x900 as f64)]);
    core.render_invoke(
        "blendFuncSeparate",
        &[n(0x302 as f64), n(0x303 as f64), n(1.0), n(0.0)],
    );
    let before = draw(&mut core);
    assert_eq!(before.state.scissor, [-1, 2, 8, 9]);
    assert_eq!(before.state.color_mask, [true, false, true, false]);
    assert_eq!(before.state.depth_range, [0.0, 1.0]);
    assert!(
        before.state.blend
            && before.state.cull
            && before.state.depth_test
            && before.state.scissor_test
    );
    core.render_invoke("scissor", &[n(0.0), n(0.0), n(-1.0), n(1.0)]);
    assert_eq!(core.get_error(), INVALID_VALUE);
    core.render_invoke("depthRange", &[n(0.9), n(0.1)]);
    assert_eq!(core.get_error(), INVALID_OPERATION);
    core.render_invoke(
        "blendFuncSeparate",
        &[n(1.0), n(0.0), n(1.0), n(0x308 as f64)],
    );
    assert_eq!(core.get_error(), INVALID_ENUM);
    assert_eq!(draw(&mut core).state, before.state);
    core.render_invoke("cullFace", &[n(0x408 as f64)]);
    assert!(matches!(
        core.render_invoke("drawArrays", &[n(4.0), n(0.0), n(3.0)]),
        Reply::Null
    ));
    assert_eq!(core.get_error(), NO_ERROR);
}

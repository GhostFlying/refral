use super::*;

const TEXTURE_2D: u32 = 0x0de1;
const CUBE: u32 = 0x8513;
const FIRST_FACE: u32 = 0x8515;
const RGBA: u32 = 0x1908;

fn number(value: u32) -> Argument {
    Argument::Number(value as f64)
}

fn handle(reply: Reply) -> ObjectHandle {
    let Reply::Handle(handle) = reply else {
        panic!("expected object")
    };
    handle
}

fn context(types: &[u32]) -> (ContextCore, ObjectHandle) {
    let (mut core, program, ..) = crate::render_tests::scene();
    let Reply::Link(request) = core.prepare_link(Some(program)) else {
        panic!("expected link")
    };
    assert!(core.commit_link(
        program,
        request.request_id,
        LinkOutcome {
            artifact_id: 12,
            success: true,
            log: String::new(),
            layout: ProgramLayout {
                samplers: types
                    .iter()
                    .enumerate()
                    .map(|(index, ty)| ActiveInfo {
                        name: format!("u_tex{index}"),
                        size: 1,
                        ty: *ty,
                    })
                    .collect(),
                ..ProgramLayout::default()
            },
        }
    ));
    core.render_invoke("useProgram", &[Argument::Handle(program)]);
    assert_eq!(core.get_error(), NO_ERROR);
    (core, program)
}

fn texture(core: &mut ContextCore, target: u32) -> ObjectHandle {
    let handle = handle(core.render_invoke("createTexture", &[]));
    core.render_invoke("bindTexture", &[number(target), Argument::Handle(handle)]);
    handle
}

fn define(
    core: &mut ContextCore,
    target: u32,
    width: u32,
    height: u32,
    format: u32,
    pixels: Argument,
) -> Reply {
    core.render_invoke(
        "texImage2D",
        &[
            number(target),
            number(0),
            number(format),
            number(width),
            number(height),
            number(0),
            number(format),
            number(0x1401),
            pixels,
        ],
    )
}

fn faces(core: &mut ContextCore, size: u32, format: u32) {
    for face in 0..6 {
        define(core, FIRST_FACE + face, size, size, format, Argument::Null);
    }
}

fn draw(core: &mut ContextCore) -> DrawSnapshot {
    let Reply::Draw(draw) =
        core.render_invoke("drawArrays", &[number(TRIANGLES), number(0), number(3)])
    else {
        panic!("expected draw")
    };
    draw
}

fn cube_versions(draw: &DrawSnapshot) -> Option<[TextureVersion; 6]> {
    let TextureImages::Cube(versions) = draw.textures[0].images else {
        panic!("expected cube")
    };
    versions
}

fn no_operations(core: &mut ContextCore) {
    let (before, after) = core.take_resource_operations();
    assert!(before.is_empty() && after.is_empty());
}

#[test]
fn first_successful_binding_fixes_type_and_units_are_independent() {
    let (mut core, _) = context(&[]);
    let fresh = handle(core.render_invoke("createTexture", &[]));
    core.render_invoke(
        "bindTexture",
        &[number(FIRST_FACE), Argument::Handle(fresh)],
    );
    assert_eq!(core.get_error(), INVALID_ENUM);
    assert!(matches!(
        core.render_invoke("isTexture", &[Argument::Handle(fresh)]),
        Reply::Boolean(false)
    ));
    core.render_invoke("bindTexture", &[number(CUBE), Argument::Handle(fresh)]);
    let two_d = texture(&mut core, TEXTURE_2D);
    core.render_invoke(
        "bindTexture",
        &[number(TEXTURE_2D), Argument::Handle(fresh)],
    );
    assert_eq!(core.get_error(), INVALID_OPERATION);
    assert!(
        matches!(core.render_invoke("getParameter", &[number(0x8069)]), Reply::Handle(value) if value == two_d)
    );
    assert!(
        matches!(core.render_invoke("getParameter", &[number(0x8514)]), Reply::Handle(value) if value == fresh)
    );
    core.render_invoke("activeTexture", &[number(0x84c1)]);
    assert!(matches!(
        core.render_invoke("getParameter", &[number(0x8514)]),
        Reply::Null
    ));
    core.render_invoke("bindTexture", &[number(CUBE), Argument::Handle(fresh)]);
    core.render_invoke("deleteTexture", &[Argument::Handle(fresh)]);
    for unit in [0x84c0, 0x84c1] {
        core.render_invoke("activeTexture", &[number(unit)]);
        assert!(matches!(
            core.render_invoke("getParameter", &[number(0x8514)]),
            Reply::Null
        ));
    }
    core.render_invoke("bindTexture", &[number(CUBE), Argument::Handle(fresh)]);
    assert_eq!(core.get_error(), INVALID_OPERATION);
    core.render_invoke(
        "bindTexture",
        &[
            number(CUBE),
            Argument::Handle(ObjectHandle {
                context_id: 2,
                ..two_d
            }),
        ],
    );
    assert_eq!(core.get_error(), INVALID_OPERATION);
    core.render_invoke("activeTexture", &[number(0x84c0)]);
    assert!(
        matches!(core.render_invoke("getParameter", &[number(0x8069)]), Reply::Handle(value) if value == two_d)
    );
}

#[test]
fn cube_completeness_tracks_each_face_and_current_parameters() {
    let (mut core, _) = context(&[0x8b60]);
    texture(&mut core, CUBE);
    assert!(cube_versions(&draw(&mut core)).is_none());
    for face in 0..6 {
        define(&mut core, FIRST_FACE + face, 1, 1, RGBA, Argument::Null);
        assert_eq!(cube_versions(&draw(&mut core)).is_some(), face == 5);
    }
    let complete = cube_versions(&draw(&mut core)).unwrap();
    for (face, version) in complete.iter().enumerate() {
        assert_eq!(
            (version.image_target, version.level),
            (FIRST_FACE + face as u32, 0)
        );
        assert_eq!(
            (version.storage_generation, version.content_version),
            (1, 1)
        );
    }
    define(&mut core, FIRST_FACE + 2, 2, 2, RGBA, Argument::Null);
    assert!(cube_versions(&draw(&mut core)).is_none());
    define(&mut core, FIRST_FACE + 2, 1, 1, 0x1907, Argument::Null);
    assert!(cube_versions(&draw(&mut core)).is_none());
    define(&mut core, FIRST_FACE + 2, 0, 0, RGBA, Argument::Null);
    assert_eq!(core.get_error(), NO_ERROR);
    assert!(cube_versions(&draw(&mut core)).is_none());
    faces(&mut core, 2, RGBA);
    assert!(cube_versions(&draw(&mut core)).is_none());
    core.render_invoke(
        "texParameteri",
        &[number(CUBE), number(0x2801), number(0x2601)],
    );
    assert!(cube_versions(&draw(&mut core)).is_some());
    faces(&mut core, 3, RGBA);
    assert!(cube_versions(&draw(&mut core)).is_none());
    core.render_invoke(
        "texParameteri",
        &[number(CUBE), number(0x2802), number(0x812f)],
    );
    assert!(cube_versions(&draw(&mut core)).is_none());
    core.render_invoke(
        "texParameteri",
        &[number(CUBE), number(0x2803), number(0x812f)],
    );
    assert!(cube_versions(&draw(&mut core)).is_some());
    core.render_invoke(
        "texParameteri",
        &[number(CUBE), number(0x2801), number(0x2702)],
    );
    assert!(cube_versions(&draw(&mut core)).is_none());
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn face_updates_are_rectangular_owned_and_independently_versioned() {
    let (mut core, _) = context(&[0x8b60]);
    let object = texture(&mut core, CUBE);
    faces(&mut core, 2, RGBA);
    core.render_invoke(
        "texParameteri",
        &[number(CUBE), number(0x2801), number(0x2600)],
    );
    let old_draw = draw(&mut core);
    let old = cube_versions(&old_draw).unwrap();
    core.take_resource_operations();
    let mut args = vec![
        number(FIRST_FACE + 3),
        number(0),
        number(1),
        number(0),
        number(1),
        number(2),
        number(RGBA),
        number(0x1401),
        Argument::Pixels {
            data: vec![11; 8],
            view: PixelView::U8,
        },
    ];
    core.render_invoke("texSubImage2D", &args);
    if let Argument::Pixels { data, .. } = &mut args[8] {
        data.fill(0);
    }
    let (operations, _) = core.take_resource_operations();
    let ResourceOperation::UpdateTexture {
        version,
        previous,
        data,
        ..
    } = &operations[0]
    else {
        panic!()
    };
    assert_eq!(*previous, old[3]);
    assert_eq!(data, &[11; 8]);
    assert_eq!(
        (version.storage_generation, version.content_version),
        (1, 2)
    );
    let current = cube_versions(&draw(&mut core)).unwrap();
    assert_eq!(current[3], *version);
    for face in [0, 1, 2, 4, 5] {
        assert_eq!(current[face], old[face]);
    }
    args[4] = number(2);
    core.render_invoke("texSubImage2D", &args);
    assert_eq!(core.get_error(), INVALID_VALUE);
    assert!(matches!(
        define(&mut core, FIRST_FACE, 1, 2, RGBA, Argument::Null),
        Reply::Null
    ));
    assert_eq!(core.get_error(), INVALID_VALUE);
    no_operations(&mut core);
    assert_eq!(cube_versions(&draw(&mut core)).unwrap(), current);
    core.render_invoke(
        "texParameteri",
        &[number(CUBE), number(0x2800), number(0x2600)],
    );
    assert_eq!(old_draw.textures[0].parameters.mag_filter, 0x2601);
    core.render_invoke("deleteTexture", &[Argument::Handle(object)]);
    let (retired, _) = core.take_resource_operations();
    assert_eq!(retired.len(), 6);
    for (face, operation) in retired.iter().enumerate() {
        assert!(
            matches!(operation, ResourceOperation::RetireTexture { version } if *version == current[face])
        );
    }
    assert_eq!(cube_versions(&old_draw).unwrap(), old);
    assert!(cube_versions(&draw(&mut core)).is_none());
}

#[test]
fn mixed_sampler_types_fail_validation_and_zero_count_draws() {
    let (mut core, program) = context(&[0x8b5e, 0x8b60]);
    core.render_invoke("validateProgram", &[Argument::Handle(program)]);
    assert!(matches!(
        core.render_invoke(
            "getProgramParameter",
            &[Argument::Handle(program), number(0x8b83)]
        ),
        Reply::Boolean(false)
    ));
    assert!(matches!(
        core.render_invoke("drawArrays", &[number(TRIANGLES), number(0), number(0)]),
        Reply::Null
    ));
    assert_eq!(core.get_error(), INVALID_OPERATION);
    let location = handle(core.render_invoke(
        "getUniformLocation",
        &[
            Argument::Handle(program),
            Argument::Text("u_tex1".encode_utf16().collect()),
        ],
    ));
    core.render_invoke("uniform1i", &[Argument::Handle(location), number(1)]);
    assert_eq!(core.get_error(), NO_ERROR);
    core.render_invoke("uniform1i", &[Argument::Handle(location), number(32)]);
    assert_eq!(core.get_error(), INVALID_VALUE);
    assert!(matches!(
        core.render_invoke(
            "getUniform",
            &[Argument::Handle(program), Argument::Handle(location)]
        ),
        Reply::Number(1.0)
    ));
    core.render_invoke("validateProgram", &[Argument::Handle(program)]);
    assert!(matches!(
        core.render_invoke(
            "getProgramParameter",
            &[Argument::Handle(program), number(0x8b83)]
        ),
        Reply::Boolean(true)
    ));
    let draw = draw(&mut core);
    assert!(matches!(
        draw.textures[0].images,
        TextureImages::Texture2D(None)
    ));
    assert!(matches!(draw.textures[1].images, TextureImages::Cube(None)));
    no_operations(&mut core);
}

#[test]
fn cube_framebuffer_selects_a_face_and_preserves_the_prior_attachment_after_errors() {
    let (mut core, _) = context(&[]);
    let two_d = texture(&mut core, TEXTURE_2D);
    define(&mut core, TEXTURE_2D, 1, 1, RGBA, Argument::Null);
    let cube = texture(&mut core, CUBE);
    let framebuffer = handle(core.render_invoke("createFramebuffer", &[]));
    core.render_invoke(
        "bindFramebuffer",
        &[number(0x8d40), Argument::Handle(framebuffer)],
    );
    let mut args = vec![
        number(0x8d40),
        number(0x8ce0),
        number(TEXTURE_2D),
        Argument::Handle(two_d),
        number(0),
    ];
    core.render_invoke("framebufferTexture2D", &args);
    args[3] = Argument::Handle(cube);
    core.render_invoke("framebufferTexture2D", &args);
    assert_eq!(core.get_error(), INVALID_OPERATION);
    assert_eq!(core.framebuffer_color_texture(), Some(two_d));
    args[2] = number(FIRST_FACE);
    core.render_invoke("framebufferTexture2D", &args);
    assert_eq!(core.get_error(), NO_ERROR);
    assert_eq!(core.framebuffer_color_texture(), Some(cube));
    args[3] = Argument::Null;
    core.render_invoke("framebufferTexture2D", &args);
    assert_eq!(core.framebuffer_color_texture(), None);
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn dom_cube_preparation_uses_face_dimensions_and_owns_transformed_pixels() {
    let (mut core, _) = context(&[0x8b60]);
    texture(&mut core, CUBE);
    core.render_invoke("pixelStorei", &[number(0x9241), number(1)]);
    let mut request = vec![
        Argument::Boolean(false),
        number(FIRST_FACE),
        number(0),
        number(RGBA),
        number(0),
        number(0),
        number(1),
        number(2),
        number(RGBA),
        number(0x1401),
        Argument::Boolean(true),
        Argument::Boolean(false),
    ];
    assert!(matches!(
        core.render_invoke("prepareDomTextureUpload", &request),
        Reply::Null
    ));
    assert_eq!(core.get_error(), INVALID_VALUE);
    no_operations(&mut core);
    request[7] = number(1);
    assert!(matches!(
        core.render_invoke("prepareDomTextureUpload", &request),
        Reply::Ints(_)
    ));
    define(
        &mut core,
        FIRST_FACE,
        1,
        1,
        RGBA,
        Argument::DomPixels {
            data: vec![200, 100, 50, 128],
            view: PixelView::U8,
            converted: false,
        },
    );
    let (operations, _) = core.take_resource_operations();
    let ResourceOperation::DefineTexture { version, data, .. } = &operations[0] else {
        panic!()
    };
    assert_eq!(version.image_target, FIRST_FACE);
    assert_eq!(data, &[100, 50, 25, 128]);
    assert!(cube_versions(&draw(&mut core)).is_none());
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn invalid_face_updates_and_exhausted_face_versions_preserve_other_images() {
    let (mut core, _) = context(&[0x8b60]);
    texture(&mut core, CUBE);
    let update = [
        number(FIRST_FACE),
        number(0),
        number(0),
        number(0),
        number(1),
        number(1),
        number(RGBA),
        number(0x1401),
        Argument::Pixels {
            data: vec![1; 4],
            view: PixelView::U8,
        },
    ];
    core.render_invoke("texSubImage2D", &update);
    assert_eq!(core.get_error(), INVALID_OPERATION);
    define(&mut core, CUBE, 1, 1, RGBA, Argument::Null);
    assert_eq!(core.get_error(), INVALID_ENUM);
    define(&mut core, FIRST_FACE, 4097, 4097, RGBA, Argument::Null);
    assert_eq!(core.get_error(), INVALID_VALUE);
    no_operations(&mut core);
    faces(&mut core, 1, RGBA);
    let versions = cube_versions(&draw(&mut core)).unwrap();
    core.take_resource_operations();
    let image = &mut core.render.textures.slots[0].value.as_mut().unwrap().images[1];
    image.content_version = MAX_SAFE_VERSION;
    core.render_invoke("texSubImage2D", &update);
    assert_eq!(core.get_error(), OUT_OF_MEMORY);
    no_operations(&mut core);
    define(&mut core, FIRST_FACE + 1, 1, 1, RGBA, Argument::Null);
    let (operations, _) = core.take_resource_operations();
    let ResourceOperation::DefineTexture { version, .. } = operations[0] else {
        panic!()
    };
    assert_eq!(version.image_target, FIRST_FACE + 1);
    assert_eq!(
        (version.storage_generation, version.content_version),
        (2, 2)
    );
    for (face, version) in versions.iter().enumerate().skip(2) {
        assert_eq!(
            core.render.textures.slots[0].value.as_ref().unwrap().images[face + 1].content_version,
            version.content_version
        );
    }
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn same_type_samplers_may_share_one_cube_unit() {
    let (mut core, program) = context(&[0x8b60, 0x8b60]);
    texture(&mut core, CUBE);
    faces(&mut core, 1, RGBA);
    core.render_invoke("validateProgram", &[Argument::Handle(program)]);
    assert!(matches!(
        core.render_invoke(
            "getProgramParameter",
            &[Argument::Handle(program), number(0x8b83)]
        ),
        Reply::Boolean(true)
    ));
    let snapshot = draw(&mut core);
    assert_eq!(snapshot.textures[0].images, snapshot.textures[1].images);
    assert_eq!(core.get_error(), NO_ERROR);
}

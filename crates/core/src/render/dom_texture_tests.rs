use super::*;

const TEXTURE_2D: u32 = 0x0de1;
const RGBA: u32 = 0x1908;
const UNSIGNED_BYTE: u32 = 0x1401;
const INVALID_DOM_DIMENSIONS: [f64; 7] = [
    0.0,
    -1.0,
    0.5,
    f64::NAN,
    f64::INFINITY,
    f64::NEG_INFINITY,
    MAX_SAFE_VERSION as f64 + 1.0,
];

fn number(value: i64) -> Argument {
    Argument::Number(value as f64)
}

fn context() -> ContextCore {
    let mut core = ContextCore::new(1, 1024 * 1024).unwrap();
    let Reply::Handle(texture) = core.render_invoke("createTexture", &[]) else {
        panic!("expected texture handle")
    };
    core.render_invoke(
        "bindTexture",
        &[number(TEXTURE_2D as i64), Argument::Handle(texture)],
    );
    core
}

fn request(sub_image: bool, width: i64, height: i64, format: u32, valid: bool) -> Vec<Argument> {
    vec![
        Argument::Boolean(sub_image),
        number(TEXTURE_2D as i64),
        number(0),
        number(format as i64),
        number(0),
        number(0),
        number(width),
        number(height),
        number(format as i64),
        number(UNSIGNED_BYTE as i64),
        Argument::Boolean(valid),
    ]
}

fn dom(data: &[u8], converted: bool) -> Argument {
    Argument::DomPixels {
        data: data.to_vec(),
        valid_u8: true,
        converted,
    }
}

fn image(core: &mut ContextCore, width: i64, height: i64, format: u32, source: Argument) {
    core.render_invoke(
        "texImage2D",
        &[
            number(TEXTURE_2D as i64),
            number(0),
            number(format as i64),
            number(width),
            number(height),
            number(0),
            number(format as i64),
            number(UNSIGNED_BYTE as i64),
            source,
        ],
    );
}

fn definition(core: &mut ContextCore) -> (TextureVersion, Vec<u8>) {
    let (mut operations, after) = core.take_resource_operations();
    assert!(after.is_empty());
    assert_eq!(operations.len(), 1);
    let ResourceOperation::DefineTexture { version, data, .. } = operations.remove(0) else {
        panic!("expected texture definition")
    };
    (version, data)
}

fn no_operations(core: &mut ContextCore) {
    let (before, after) = core.take_resource_operations();
    assert!(before.is_empty());
    assert!(after.is_empty());
}

#[test]
fn preparation_returns_owned_unpack_state_without_resource_mutation() {
    let mut core = context();
    core.render_invoke("pixelStorei", &[number(0x9240), number(1)]);
    core.render_invoke("pixelStorei", &[number(0x9241), number(1)]);
    core.render_invoke("pixelStorei", &[number(0x9243), number(0)]);
    let Reply::Ints(flags) =
        core.render_invoke("prepareDomTextureUpload", &request(false, 1, 2, RGBA, true))
    else {
        panic!("expected upload preparation flags")
    };
    assert_eq!(flags, [1, 1, 0]);
    no_operations(&mut core);
    core.render_invoke("pixelStorei", &[number(0x9240), number(0)]);
    core.render_invoke("pixelStorei", &[number(0x9241), number(0)]);
    image(&mut core, 1, 1, RGBA, dom(&[11, 77, 203, 0], false));
    let (version, pixels) = definition(&mut core);
    assert_eq!(pixels, [11, 77, 203, 0]);
    assert_eq!(
        (version.storage_generation, version.content_version),
        (1, 1)
    );
    assert_eq!(flags, [1, 1, 0]);
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn unavailable_source_precedes_binding_target_and_dimensions_validation() {
    let mut core = ContextCore::new(1, 1024).unwrap();
    let mut args = request(false, -1, -1, 0xbad, false);
    args[1] = number(0xbad);
    assert!(matches!(
        core.render_invoke("prepareDomTextureUpload", &args),
        Reply::Null
    ));
    assert_eq!(core.get_error(), INVALID_VALUE);
    args[10] = Argument::Boolean(true);
    args[6] = number(1);
    args[7] = number(1);
    assert!(matches!(
        core.render_invoke("prepareDomTextureUpload", &args),
        Reply::Null
    ));
    assert_eq!(core.get_error(), INVALID_ENUM);
    args[1] = number(TEXTURE_2D as i64);
    core.render_invoke("prepareDomTextureUpload", &args);
    assert_eq!(core.get_error(), INVALID_OPERATION);
    no_operations(&mut core);
}

#[test]
fn preparation_validates_source_dimensions_before_gl_parameters() {
    let mut core = context();
    image(&mut core, 1, 1, RGBA, Argument::Null);
    let (initial, _) = definition(&mut core);
    for sub_image in [false, true] {
        for invalid in INVALID_DOM_DIMENSIONS {
            for (width, height) in [(invalid, 1.0), (1.0, invalid)] {
                let mut args = request(sub_image, 1, 1, RGBA, true);
                args[1] = number(0xbad);
                args[6] = Argument::Number(width);
                args[7] = Argument::Number(height);
                assert!(matches!(
                    core.render_invoke("prepareDomTextureUpload", &args),
                    Reply::Null
                ));
                assert_eq!(core.get_error(), INVALID_VALUE);
                assert_eq!(core.texture_version(0), initial);
                no_operations(&mut core);
            }
        }
        for (width, height) in [
            (MAX_SAFE_VERSION as f64, 1.0),
            (1.0, MAX_SAFE_VERSION as f64),
        ] {
            let mut args = request(sub_image, 1, 1, RGBA, true);
            args[1] = number(0xbad);
            args[6] = Argument::Number(width);
            args[7] = Argument::Number(height);
            core.render_invoke("prepareDomTextureUpload", &args);
            assert_eq!(core.get_error(), INVALID_ENUM);
            assert_eq!(core.texture_version(0), initial);
            no_operations(&mut core);
        }
    }
}

#[test]
fn dom_commits_reject_invalid_source_dimensions_without_changing_storage() {
    let mut core = context();
    image(&mut core, 1, 1, RGBA, Argument::Null);
    let (initial, _) = definition(&mut core);
    for converted in [false, true] {
        for invalid in INVALID_DOM_DIMENSIONS {
            for (width, height) in [(invalid, 1.0), (1.0, invalid)] {
                for target in [TEXTURE_2D, 0xbad] {
                    let mut args = vec![
                        number(target as i64),
                        number(0),
                        number(RGBA as i64),
                        Argument::Number(width),
                        Argument::Number(height),
                        number(0),
                        number(RGBA as i64),
                        number(UNSIGNED_BYTE as i64),
                        dom(&[11, 77, 203, 0], converted),
                    ];
                    core.render_invoke("texImage2D", &args);
                    assert_eq!(core.get_error(), INVALID_VALUE);
                    assert_eq!(core.texture_version(0), initial);
                    no_operations(&mut core);
                    args[2] = number(0);
                    args[3] = number(0);
                    args[4] = Argument::Number(width);
                    args[5] = Argument::Number(height);
                    core.render_invoke("texSubImage2D", &args);
                    assert_eq!(core.get_error(), INVALID_VALUE);
                    assert_eq!(core.texture_version(0), initial);
                    no_operations(&mut core);
                }
            }
        }
    }
    let storage = core.render.textures.slots[0]
        .value
        .as_ref()
        .unwrap()
        .storage
        .unwrap();
    assert_eq!(
        (storage.width, storage.height, storage.format),
        (1, 1, RGBA)
    );
}

#[test]
fn typed_and_null_uploads_preserve_zero_size_behavior() {
    let mut core = context();
    for (width, height) in [(0, 1), (1, 0)] {
        for source in [
            Argument::Null,
            Argument::Pixels {
                data: Vec::new(),
                valid_u8: true,
            },
        ] {
            image(&mut core, width, height, RGBA, source);
            let (_, pixels) = definition(&mut core);
            assert!(pixels.is_empty());
            let storage = core.render.textures.slots[0]
                .value
                .as_ref()
                .unwrap()
                .storage
                .unwrap();
            assert_eq!(
                (storage.width, storage.height),
                (width as u32, height as u32)
            );
            assert_eq!(core.get_error(), NO_ERROR);
        }
    }
    image(&mut core, 1, 1, RGBA, Argument::Null);
    let (initial, _) = definition(&mut core);
    for (width, height) in [(0, 1), (1, 0)] {
        core.render_invoke(
            "texSubImage2D",
            &[
                number(TEXTURE_2D as i64),
                number(0),
                number(0),
                number(0),
                number(width),
                number(height),
                number(RGBA as i64),
                number(UNSIGNED_BYTE as i64),
                Argument::Pixels {
                    data: Vec::new(),
                    valid_u8: true,
                },
            ],
        );
        assert_eq!(core.get_error(), NO_ERROR);
        assert_eq!(core.texture_version(0), initial);
        no_operations(&mut core);
    }
}

#[test]
fn prepares_with_shared_definition_and_update_validation() {
    let mut core = context();
    let mut args = request(false, 1, 1, RGBA, true);
    args[2] = number(-1);
    core.render_invoke("prepareDomTextureUpload", &args);
    assert_eq!(core.get_error(), INVALID_VALUE);
    args[2] = number(0);
    args[3] = number(0x1907);
    core.render_invoke("prepareDomTextureUpload", &args);
    assert_eq!(core.get_error(), INVALID_OPERATION);
    args[3] = number(RGBA as i64);
    args[8] = number(0xbad);
    core.render_invoke("prepareDomTextureUpload", &args);
    assert_eq!(core.get_error(), INVALID_ENUM);
    args[8] = number(RGBA as i64);
    args[6] = number(4097);
    core.render_invoke("prepareDomTextureUpload", &args);
    assert_eq!(core.get_error(), INVALID_VALUE);
    let mut update = request(true, 1, 1, RGBA, true);
    core.render_invoke("prepareDomTextureUpload", &update);
    assert_eq!(core.get_error(), INVALID_OPERATION);
    no_operations(&mut core);
    image(&mut core, 2, 2, RGBA, Argument::Null);
    let (version, _) = definition(&mut core);
    assert!(matches!(
        core.render_invoke("prepareDomTextureUpload", &update),
        Reply::Ints(_)
    ));
    update[4] = number(2);
    core.render_invoke("prepareDomTextureUpload", &update);
    assert_eq!(core.get_error(), INVALID_VALUE);
    no_operations(&mut core);
    assert_eq!(
        (version.storage_generation, version.content_version),
        (1, 1)
    );
}

#[test]
fn dom_rows_are_tight_and_preserve_transparent_rgb() {
    for alignment in [1, 2, 4, 8] {
        let mut core = context();
        core.render_invoke("pixelStorei", &[number(0x0cf5), number(alignment)]);
        image(
            &mut core,
            1,
            2,
            RGBA,
            dom(&[11, 77, 203, 0, 201, 109, 19, 1], false),
        );
        let (_, pixels) = definition(&mut core);
        assert_eq!(pixels, [11, 77, 203, 0, 201, 109, 19, 1]);
        assert_eq!(core.get_error(), NO_ERROR);
    }
    let mut core = context();
    core.render_invoke("pixelStorei", &[number(0x0cf5), number(8)]);
    image(
        &mut core,
        1,
        2,
        RGBA,
        Argument::Pixels {
            data: vec![1; 8],
            valid_u8: true,
        },
    );
    assert_eq!(core.get_error(), INVALID_OPERATION);
    no_operations(&mut core);
    image(
        &mut core,
        1,
        2,
        RGBA,
        Argument::Pixels {
            data: vec![1; 12],
            valid_u8: true,
        },
    );
    definition(&mut core);
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn dom_premultiply_uses_source_alpha_before_format_conversion() {
    for (format, expected) in [
        (RGBA, [100, 50, 25, 128]),
        (0x1907, [100, 50, 25, 255]),
        (0x1906, [0, 0, 0, 128]),
        (0x1909, [100, 100, 100, 255]),
        (0x190a, [100, 100, 100, 128]),
    ] {
        let mut core = context();
        core.render_invoke("pixelStorei", &[number(0x9241), number(1)]);
        image(&mut core, 1, 1, format, dom(&[200, 100, 50, 128], false));
        let (_, pixels) = definition(&mut core);
        assert_eq!(pixels, expected);
        assert_eq!(core.get_error(), NO_ERROR);
    }
}

#[test]
fn converted_dom_pixels_skip_core_flip_and_premultiply() {
    let mut core = context();
    core.render_invoke("pixelStorei", &[number(0x9240), number(1)]);
    core.render_invoke("pixelStorei", &[number(0x9241), number(1)]);
    image(
        &mut core,
        1,
        2,
        RGBA,
        dom(&[11, 77, 203, 0, 200, 100, 50, 128], false),
    );
    let (_, pixels) = definition(&mut core);
    assert_eq!(pixels, [100, 50, 25, 128, 0, 0, 0, 0]);
    image(&mut core, 1, 2, RGBA, dom(&pixels, true));
    let (_, converted) = definition(&mut core);
    assert_eq!(converted, pixels);
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn dom_updates_own_their_pixels_and_failed_updates_preserve_versions() {
    let mut core = context();
    image(&mut core, 2, 2, RGBA, Argument::Null);
    let (first, _) = definition(&mut core);
    core.render_invoke("pixelStorei", &[number(0x0cf5), number(8)]);
    let mut args = vec![
        number(TEXTURE_2D as i64),
        number(0),
        number(1),
        number(0),
        number(1),
        number(2),
        number(RGBA as i64),
        number(UNSIGNED_BYTE as i64),
        dom(&[11, 77, 203, 0, 201, 109, 19, 1], false),
    ];
    core.render_invoke("texSubImage2D", &args);
    if let Argument::DomPixels { data, .. } = &mut args[8] {
        data.fill(0);
    }
    let (mut operations, after) = core.take_resource_operations();
    assert!(after.is_empty());
    let ResourceOperation::UpdateTexture {
        version,
        previous,
        data,
        x,
        y,
        ..
    } = operations.remove(0)
    else {
        panic!("expected texture update")
    };
    assert_eq!(previous, first);
    assert_eq!(
        (version.storage_generation, version.content_version),
        (1, 2)
    );
    assert_eq!((x, y), (1, 0));
    assert_eq!(data, [11, 77, 203, 0, 201, 109, 19, 1]);
    args[8] = dom(&[1, 2, 3], false);
    core.render_invoke("texSubImage2D", &args);
    assert_eq!(core.get_error(), INVALID_OPERATION);
    no_operations(&mut core);
    args[8] = Argument::DomPixels {
        data: vec![1; 8],
        valid_u8: false,
        converted: false,
    };
    core.render_invoke("texSubImage2D", &args);
    assert_eq!(core.get_error(), INVALID_OPERATION);
    no_operations(&mut core);
    args[8] = dom(&[1; 8], false);
    core.render_invoke("texSubImage2D", &args);
    let (mut operations, _) = core.take_resource_operations();
    let ResourceOperation::UpdateTexture { version, .. } = operations.remove(0) else {
        panic!()
    };
    assert_eq!(
        (version.storage_generation, version.content_version),
        (1, 3)
    );
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn dom_preparation_reports_version_capacity_and_neutral_loss() {
    let mut core = context();
    core.render.textures.slots[0]
        .value
        .as_mut()
        .unwrap()
        .storage_generation = MAX_SAFE_VERSION;
    assert!(matches!(
        core.render_invoke("prepareDomTextureUpload", &request(false, 1, 1, RGBA, true)),
        Reply::Null
    ));
    assert_eq!(core.get_error(), OUT_OF_MEMORY);
    no_operations(&mut core);
    core.mark_lost();
    assert_eq!(core.get_error(), CONTEXT_LOST_WEBGL);
    assert!(matches!(
        core.render_invoke(
            "prepareDomTextureUpload",
            &request(false, 1, 1, RGBA, false)
        ),
        Reply::Null
    ));
    assert_eq!(core.get_error(), NO_ERROR);
}

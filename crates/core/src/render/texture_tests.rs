use super::*;

fn number(value: u32) -> Argument {
    Argument::Number(value as f64)
}
fn handle(reply: Reply) -> ObjectHandle {
    if let Reply::Handle(handle) = reply {
        handle
    } else {
        panic!("expected texture handle")
    }
}
fn bound() -> (ContextCore, ObjectHandle) {
    let mut core = ContextCore::new(1, 1024 * 1024).unwrap();
    let texture = handle(core.render_invoke("createTexture", &[]));
    assert!(matches!(
        core.render_invoke("isTexture", &[Argument::Handle(texture)]),
        Reply::Boolean(false)
    ));
    core.render_invoke("bindTexture", &[number(0x0de1), Argument::Handle(texture)]);
    (core, texture)
}
fn image(core: &mut ContextCore, width: u32, height: u32, format: u32, pixels: Argument) {
    core.render_invoke(
        "texImage2D",
        &[
            number(0x0de1),
            number(0),
            number(format),
            number(width),
            number(height),
            number(0),
            number(format),
            number(0x1401),
            pixels,
        ],
    );
}
fn pixels(data: &[u8]) -> Argument {
    Argument::Pixels {
        data: data.to_vec(),
        view: PixelView::U8,
    }
}
fn definition(core: &mut ContextCore) -> (TextureVersion, u32, u32, Vec<u8>) {
    let (mut before, after) = core.take_resource_operations();
    assert!(after.is_empty());
    assert_eq!(before.len(), 1);
    let ResourceOperation::DefineTexture {
        version,
        width,
        height,
        data,
        ..
    } = before.remove(0)
    else {
        panic!()
    };
    (version, width, height, data)
}
#[test]
fn texture_formats_alignment_flip_premultiply_and_owned_inputs() {
    for (format, input, expected) in [
        (0x1908, vec![10, 20, 30, 40], vec![10, 20, 30, 40]),
        (0x1907, vec![10, 20, 30], vec![10, 20, 30, 255]),
        (0x1906, vec![40], vec![0, 0, 0, 40]),
        (0x1909, vec![10], vec![10, 10, 10, 255]),
        (0x190a, vec![10, 40], vec![10, 10, 10, 40]),
    ] {
        let (mut core, texture) = bound();
        image(&mut core, 1, 1, format, pixels(&input));
        let (version, _, _, data) = definition(&mut core);
        assert_eq!(data, expected);
        assert_eq!(version.texture, texture);
        assert_eq!(
            (version.storage_generation, version.content_version),
            (1, 1)
        );
        assert_eq!(core.get_error(), NO_ERROR);
    }
    let (mut core, _) = bound();
    core.render_invoke("pixelStorei", &[number(0x9240), number(1)]);
    core.render_invoke("pixelStorei", &[number(0x9241), number(1)]);
    image(
        &mut core,
        1,
        2,
        0x1908,
        pixels(&[100, 50, 0, 255, 200, 100, 50, 128]),
    );
    let (_, _, _, data) = definition(&mut core);
    assert_eq!(data, [100, 50, 25, 128, 100, 50, 0, 255]);
    let (mut core, _) = bound();
    image(
        &mut core,
        2,
        2,
        0x1907,
        pixels(&[1, 2, 3, 4, 5, 6, 99, 99, 7, 8, 9, 10, 11, 12]),
    );
    assert_eq!(
        definition(&mut core).3,
        [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]
    );
}
#[test]
fn texture_null_initialization_update_versions_and_failed_calls_are_atomic() {
    let (mut core, texture) = bound();
    image(&mut core, 2, 2, 0x1907, Argument::Null);
    let (first, _, _, data) = definition(&mut core);
    assert_eq!(data, [0, 0, 0, 255].repeat(4));
    let update = |source| {
        vec![
            number(0x0de1),
            number(0),
            number(0),
            number(0),
            number(1),
            number(1),
            number(0x1907),
            number(0x1401),
            source,
        ]
    };
    core.render_invoke("texSubImage2D", &update(Argument::Null));
    assert_eq!(core.get_error(), INVALID_VALUE);
    assert!(core.take_resource_operations().0.is_empty());
    core.render_invoke(
        "texSubImage2D",
        &update(Argument::Pixels {
            data: vec![0; 3],
            view: PixelView::Other,
        }),
    );
    assert_eq!(core.get_error(), INVALID_OPERATION);
    core.render_invoke("texSubImage2D", &update(pixels(&[9, 8, 7])));
    let (before, _) = core.take_resource_operations();
    let ResourceOperation::UpdateTexture {
        version,
        previous,
        data,
        ..
    } = &before[0]
    else {
        panic!()
    };
    assert_eq!(*previous, first);
    assert_eq!(version.content_version, 2);
    assert_eq!(version.storage_generation, 1);
    assert_eq!(data, &[9, 8, 7, 255]);
    image(&mut core, 1, 1, 0x1908, Argument::Null);
    assert_eq!(
        (definition(&mut core).0.storage_generation, core.get_error()),
        (2, NO_ERROR)
    );
    core.render_invoke("deleteTexture", &[Argument::Handle(texture)]);
    let (before, _) = core.take_resource_operations();
    assert!(matches!(before[0], ResourceOperation::RetireTexture { .. }));
    assert!(matches!(
        core.render_invoke("getParameter", &[number(0x8069)]),
        Reply::Null
    ));
    assert!(matches!(
        core.render_invoke("isTexture", &[Argument::Handle(texture)]),
        Reply::Boolean(false)
    ));
    core.render_invoke("deleteTexture", &[Argument::Handle(texture)]);
    assert_eq!(core.get_error(), NO_ERROR);
}
#[test]
fn texture_completeness_and_units_use_current_versions_without_pixel_reuploads() {
    let (mut core, texture) = bound();
    image(&mut core, 1, 1, 0x1908, pixels(&[1, 2, 3, 4]));
    definition(&mut core);
    let index = slot_index(
        &core.render.textures.slots,
        texture,
        ObjectKind::Texture,
        core.context_id,
    )
    .unwrap();
    assert!(textures::texture_complete(
        core.render.textures.slots[index].value.as_ref().unwrap()
    ));
    image(&mut core, 3, 2, 0x1909, Argument::Null);
    definition(&mut core);
    assert!(!textures::texture_complete(
        core.render.textures.slots[index].value.as_ref().unwrap()
    ));
    for (parameter, value) in [(0x2801, 0x2601), (0x2802, 0x812f), (0x2803, 0x812f)] {
        core.render_invoke(
            "texParameteri",
            &[number(0x0de1), number(parameter), number(value)],
        );
    }
    assert!(textures::texture_complete(
        core.render.textures.slots[index].value.as_ref().unwrap()
    ));
    core.render_invoke("activeTexture", &[number(0x84c1)]);
    assert!(matches!(
        core.render_invoke("getParameter", &[number(0x8069)]),
        Reply::Null
    ));
    core.render_invoke("bindTexture", &[number(0x0de1), Argument::Handle(texture)]);
    assert!(matches!(
        core.render_invoke("getParameter", &[number(0x8069)]),
        Reply::Handle(_)
    ));
    assert!(core.take_resource_operations().0.is_empty());
    core.render_invoke("activeTexture", &[number(0x84c8)]);
    assert_eq!(core.get_error(), INVALID_ENUM);
}

#[test]
fn impossible_texture_byte_sizes_report_oom_and_preserve_storage_versions() {
    let (mut core, texture) = bound();
    image(&mut core, 1, 1, 0x1908, Argument::Null);
    let (old, _, _, _) = definition(&mut core);
    core.configure_texture_dimension(u32::MAX);
    image(
        &mut core,
        i32::MAX as u32,
        i32::MAX as u32,
        0x1908,
        Argument::Null,
    );
    assert_eq!(core.get_error(), OUT_OF_MEMORY);
    assert!(core.take_resource_operations().0.is_empty());
    let index = slot_index(
        &core.render.textures.slots,
        texture,
        ObjectKind::Texture,
        core.context_id,
    )
    .unwrap();
    assert_eq!(core.texture_version(index), old);
}

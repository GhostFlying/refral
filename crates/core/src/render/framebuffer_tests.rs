use super::*;

fn number(value: u32) -> Argument {
    Argument::Number(value as f64)
}
fn invoke(core: &mut ContextCore, operation: &str, args: &[Argument]) -> Reply {
    core.framebuffer_invoke(operation, args).unwrap()
}
fn object(reply: Reply) -> ObjectHandle {
    match reply {
        Reply::Handle(handle) => handle,
        _ => panic!("expected logical object handle"),
    }
}
fn numeric(reply: Reply) -> u32 {
    match reply {
        Reply::Number(value) => value as u32,
        _ => panic!("expected numeric query result"),
    }
}
fn context() -> ContextCore {
    let mut core = ContextCore::new(1, 1024 * 1024).unwrap();
    core.render.surface = [64, 32];
    core
}
fn bind_framebuffer(core: &mut ContextCore, handle: Option<ObjectHandle>) {
    invoke(
        core,
        "bindFramebuffer",
        &[
            number(FRAMEBUFFER),
            handle.map_or(Argument::Null, Argument::Handle),
        ],
    );
}
fn create_framebuffer(core: &mut ContextCore) -> ObjectHandle {
    let handle = object(invoke(core, "createFramebuffer", &[]));
    bind_framebuffer(core, Some(handle));
    handle
}
fn texture_image(core: &mut ContextCore, width: u32, height: u32, format: u32) {
    core.texture_invoke(
        "texImage2D",
        &[
            number(TEXTURE_2D),
            number(0),
            number(format),
            number(width),
            number(height),
            number(0),
            number(format),
            number(0x1401),
            Argument::Null,
        ],
    )
    .unwrap();
}
fn create_texture(core: &mut ContextCore, width: u32, height: u32, format: u32) -> ObjectHandle {
    let handle = object(core.texture_invoke("createTexture", &[]).unwrap());
    core.texture_invoke(
        "bindTexture",
        &[number(TEXTURE_2D), Argument::Handle(handle)],
    )
    .unwrap();
    texture_image(core, width, height, format);
    handle
}
fn create_depth(core: &mut ContextCore, width: u32, height: u32) -> ObjectHandle {
    let handle = object(invoke(core, "createRenderbuffer", &[]));
    invoke(
        core,
        "bindRenderbuffer",
        &[number(RENDERBUFFER), Argument::Handle(handle)],
    );
    invoke(
        core,
        "renderbufferStorage",
        &[
            number(RENDERBUFFER),
            number(DEPTH_COMPONENT16),
            number(width),
            number(height),
        ],
    );
    handle
}
fn attach_color(core: &mut ContextCore, handle: Option<ObjectHandle>) {
    invoke(
        core,
        "framebufferTexture2D",
        &[
            number(FRAMEBUFFER),
            number(COLOR_ATTACHMENT0),
            number(TEXTURE_2D),
            handle.map_or(Argument::Null, Argument::Handle),
            number(0),
        ],
    );
}
fn attach_depth(core: &mut ContextCore, handle: Option<ObjectHandle>) {
    invoke(
        core,
        "framebufferRenderbuffer",
        &[
            number(FRAMEBUFFER),
            number(DEPTH_ATTACHMENT),
            number(RENDERBUFFER),
            handle.map_or(Argument::Null, Argument::Handle),
        ],
    );
}
fn status(core: &mut ContextCore) -> u32 {
    numeric(invoke(
        core,
        "checkFramebufferStatus",
        &[number(FRAMEBUFFER)],
    ))
}
fn attachment(core: &mut ContextCore, point: u32, parameter: u32) -> Reply {
    invoke(
        core,
        "getFramebufferAttachmentParameter",
        &[number(FRAMEBUFFER), number(point), number(parameter)],
    )
}
fn complete_target(core: &mut ContextCore) -> (ObjectHandle, ObjectHandle, ObjectHandle) {
    let texture = create_texture(core, 2, 2, RGBA);
    let depth = create_depth(core, 2, 2);
    let framebuffer = create_framebuffer(core);
    attach_color(core, Some(texture));
    attach_depth(core, Some(depth));
    core.take_resource_operations();
    (framebuffer, texture, depth)
}

fn component_bits(core: &ContextCore) -> [u32; 6] {
    std::array::from_fn(|index| numeric(core.framebuffer_query(0x0d52 + index as u32).unwrap()))
}

#[test]
fn component_queries_follow_context_attributes_and_rgba_attachments() {
    let mut core = context();
    assert_eq!(component_bits(&core), [8, 8, 8, 8, 24, 0]);
    core.render.context_alpha = false;
    core.render.context_depth = false;
    assert_eq!(component_bits(&core), [8, 8, 8, 0, 0, 0]);
    create_framebuffer(&mut core);
    let texture = create_texture(&mut core, 2, 2, RGBA);
    attach_color(&mut core, Some(texture));
    assert_eq!(component_bits(&core), [8, 8, 8, 8, 0, 0]);
    let depth = create_depth(&mut core, 2, 2);
    attach_depth(&mut core, Some(depth));
    assert_eq!(component_bits(&core), [8, 8, 8, 8, 24, 0]);
    attach_depth(&mut core, None);
    assert_eq!(component_bits(&core), [8, 8, 8, 8, 0, 0]);
    bind_framebuffer(&mut core, None);
    assert_eq!(component_bits(&core), [8, 8, 8, 0, 0, 0]);
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn component_queries_handle_absent_images_and_unsupported_rgb_targets_without_errors() {
    let mut core = context();
    create_framebuffer(&mut core);
    assert_eq!(component_bits(&core), [0; 6]);
    let depth = create_depth(&mut core, 2, 2);
    attach_depth(&mut core, Some(depth));
    assert_eq!(component_bits(&core), [0, 0, 0, 0, 24, 0]);
    assert_eq!(status(&mut core), UNSUPPORTED);
    let color = create_texture(&mut core, 2, 2, RGB);
    attach_color(&mut core, Some(color));
    assert_eq!(component_bits(&core), [8, 8, 8, 0, 24, 0]);
    assert_eq!(status(&mut core), UNSUPPORTED);
    invoke(&mut core, "deleteRenderbuffer", &[Argument::Handle(depth)]);
    assert_eq!(component_bits(&core), [8, 8, 8, 0, 0, 0]);
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn names_require_first_binding_and_validate_context_kind_generation() {
    let mut core = context();
    for (create, bind, is, delete, target) in [
        (
            "createFramebuffer",
            "bindFramebuffer",
            "isFramebuffer",
            "deleteFramebuffer",
            FRAMEBUFFER,
        ),
        (
            "createRenderbuffer",
            "bindRenderbuffer",
            "isRenderbuffer",
            "deleteRenderbuffer",
            RENDERBUFFER,
        ),
    ] {
        let handle = object(invoke(&mut core, create, &[]));
        assert!(matches!(
            invoke(&mut core, is, &[Argument::Handle(handle)]),
            Reply::Boolean(false)
        ));
        invoke(&mut core, bind, &[number(0), Argument::Handle(handle)]);
        assert_eq!(core.get_error(), INVALID_ENUM);
        assert!(matches!(
            invoke(&mut core, is, &[Argument::Handle(handle)]),
            Reply::Boolean(false)
        ));
        invoke(&mut core, bind, &[number(target), Argument::Handle(handle)]);
        assert!(matches!(
            invoke(&mut core, is, &[Argument::Handle(handle)]),
            Reply::Boolean(true)
        ));
        let foreign = ObjectHandle {
            context_id: 2,
            ..handle
        };
        invoke(&mut core, bind, &[number(0), Argument::Handle(foreign)]);
        assert_eq!(core.get_error(), INVALID_OPERATION);
        assert!(matches!(
            invoke(&mut core, is, &[Argument::Handle(foreign)]),
            Reply::Boolean(false)
        ));
        assert_eq!(core.get_error(), NO_ERROR);
        invoke(&mut core, delete, &[Argument::Handle(handle)]);
        invoke(&mut core, delete, &[Argument::Handle(handle)]);
        assert_eq!(core.get_error(), NO_ERROR);
        let replacement = object(invoke(&mut core, create, &[]));
        assert_eq!(replacement.slot, handle.slot);
        assert_eq!(replacement.generation, handle.generation + 1);
        invoke(&mut core, delete, &[Argument::Handle(handle)]);
        invoke(&mut core, bind, &[number(target), Argument::Handle(handle)]);
        assert_eq!(core.get_error(), INVALID_OPERATION);
    }
    let framebuffer = object(invoke(&mut core, "createFramebuffer", &[]));
    invoke(
        &mut core,
        "bindRenderbuffer",
        &[number(RENDERBUFFER), Argument::Handle(framebuffer)],
    );
    assert_eq!(core.get_error(), INVALID_OPERATION);
}

#[test]
fn initial_renderbuffer_queries_and_storage_failures_preserve_state() {
    let mut core = context();
    let depth = object(invoke(&mut core, "createRenderbuffer", &[]));
    invoke(
        &mut core,
        "bindRenderbuffer",
        &[number(RENDERBUFFER), Argument::Handle(depth)],
    );
    for (parameter, expected) in [(0x8d42, 0), (0x8d43, 0), (0x8d44, RGBA4), (0x8d54, 0)] {
        assert_eq!(
            numeric(invoke(
                &mut core,
                "getRenderbufferParameter",
                &[number(RENDERBUFFER), number(parameter)]
            )),
            expected
        );
    }
    invoke(
        &mut core,
        "renderbufferStorage",
        &[
            number(RENDERBUFFER),
            number(DEPTH_COMPONENT16),
            number(2),
            number(3),
        ],
    );
    invoke(
        &mut core,
        "renderbufferStorage",
        &[number(RENDERBUFFER), number(0xdead), number(4), number(5)],
    );
    assert_eq!(core.get_error(), INVALID_ENUM);
    invoke(
        &mut core,
        "renderbufferStorage",
        &[
            number(RENDERBUFFER),
            number(DEPTH_STENCIL),
            number(u32::MAX),
            number(5),
        ],
    );
    assert_eq!(core.get_error(), INVALID_VALUE);
    for (parameter, expected) in [
        (0x8d42, 2),
        (0x8d43, 3),
        (0x8d44, DEPTH_COMPONENT16),
        (0x8d54, 24),
    ] {
        assert_eq!(
            numeric(invoke(
                &mut core,
                "getRenderbufferParameter",
                &[number(RENDERBUFFER), number(parameter)]
            )),
            expected
        );
    }
    assert_eq!(core.get_error(), NO_ERROR);
    assert!(core.take_resource_operations().0.is_empty());
}

#[test]
fn completeness_distinguishes_missing_undefined_dimensions_and_profile_targets() {
    let mut core = context();
    create_framebuffer(&mut core);
    assert_eq!(status(&mut core), MISSING_ATTACHMENT);
    let texture = object(core.texture_invoke("createTexture", &[]).unwrap());
    attach_color(&mut core, Some(texture));
    assert_eq!(core.get_error(), INVALID_OPERATION);
    core.texture_invoke(
        "bindTexture",
        &[number(TEXTURE_2D), Argument::Handle(texture)],
    )
    .unwrap();
    attach_color(&mut core, Some(texture));
    assert_eq!(status(&mut core), INCOMPLETE_ATTACHMENT);
    texture_image(&mut core, 2, 2, RGBA);
    assert_eq!(status(&mut core), COMPLETE);
    let depth = create_depth(&mut core, 3, 2);
    attach_depth(&mut core, Some(depth));
    assert_eq!(status(&mut core), INCOMPLETE_DIMENSIONS);
    invoke(
        &mut core,
        "renderbufferStorage",
        &[
            number(RENDERBUFFER),
            number(DEPTH_COMPONENT16),
            number(2),
            number(2),
        ],
    );
    assert_eq!(status(&mut core), COMPLETE);
    attach_color(&mut core, None);
    assert_eq!(status(&mut core), UNSUPPORTED);
    attach_color(&mut core, Some(texture));
    texture_image(&mut core, 2, 2, RGB);
    assert_eq!(status(&mut core), UNSUPPORTED);
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn attachment_queries_follow_native_object_type_rules() {
    let mut core = context();
    create_framebuffer(&mut core);
    assert_eq!(numeric(attachment(&mut core, DEPTH_ATTACHMENT, 0x8cd0)), 0);
    for parameter in [0x8cd1, 0x8cd2, 0x8cd3] {
        assert!(matches!(
            attachment(&mut core, DEPTH_ATTACHMENT, parameter),
            Reply::Null
        ));
        assert_eq!(core.get_error(), INVALID_ENUM);
    }
    let depth = create_depth(&mut core, 2, 2);
    attach_depth(&mut core, Some(depth));
    assert_eq!(
        object(attachment(&mut core, DEPTH_ATTACHMENT, 0x8cd1)),
        depth
    );
    assert_eq!(
        numeric(attachment(&mut core, DEPTH_ATTACHMENT, 0x8cd0)),
        RENDERBUFFER
    );
    for parameter in [0x8cd2, 0x8cd3] {
        assert!(matches!(
            attachment(&mut core, DEPTH_ATTACHMENT, parameter),
            Reply::Null
        ));
        assert_eq!(core.get_error(), INVALID_ENUM);
    }
    let texture = create_texture(&mut core, 2, 2, RGBA);
    attach_color(&mut core, Some(texture));
    assert_eq!(
        object(attachment(&mut core, COLOR_ATTACHMENT0, 0x8cd1)),
        texture
    );
    assert_eq!(numeric(attachment(&mut core, COLOR_ATTACHMENT0, 0x8cd2)), 0);
    assert_eq!(numeric(attachment(&mut core, COLOR_ATTACHMENT0, 0x8cd3)), 0);
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn repeated_deletion_preserves_other_framebuffer_references_and_final_retirement() {
    let mut core = context();
    let (first, texture, depth) = complete_target(&mut core);
    let second = create_framebuffer(&mut core);
    attach_color(&mut core, Some(texture));
    attach_depth(&mut core, Some(depth));
    bind_framebuffer(&mut core, Some(first));
    core.texture_invoke("deleteTexture", &[Argument::Handle(texture)])
        .unwrap();
    invoke(&mut core, "deleteRenderbuffer", &[Argument::Handle(depth)]);
    assert!(core.take_resource_operations().0.is_empty());
    bind_framebuffer(&mut core, Some(second));
    core.texture_invoke("deleteTexture", &[Argument::Handle(texture)])
        .unwrap();
    invoke(&mut core, "deleteRenderbuffer", &[Argument::Handle(depth)]);
    assert_eq!(
        object(attachment(&mut core, COLOR_ATTACHMENT0, 0x8cd1)),
        texture
    );
    assert_eq!(
        object(attachment(&mut core, DEPTH_ATTACHMENT, 0x8cd1)),
        depth
    );
    assert_eq!(status(&mut core), COMPLETE);
    invoke(&mut core, "deleteFramebuffer", &[Argument::Handle(first)]);
    invoke(&mut core, "deleteFramebuffer", &[Argument::Handle(second)]);
    invoke(&mut core, "deleteFramebuffer", &[Argument::Handle(second)]);
    let (before, after) = core.take_resource_operations();
    assert!(after.is_empty());
    assert_eq!(before.len(), 2);
    assert!(
        matches!(&before[0], ResourceOperation::RetireTexture { version } if version.texture == texture)
    );
    assert!(
        matches!(&before[1], ResourceOperation::RetireRenderbuffer { renderbuffer, storage_generation: 1 } if *renderbuffer == depth)
    );
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn resize_preserves_prior_target_identity_and_retires_each_depth_generation() {
    let mut core = context();
    let (_, texture, depth) = complete_target(&mut core);
    let previous = core.target_snapshot(true).unwrap();
    invoke(
        &mut core,
        "renderbufferStorage",
        &[
            number(RENDERBUFFER),
            number(DEPTH_COMPONENT16),
            number(3),
            number(2),
        ],
    );
    assert_eq!(status(&mut core), INCOMPLETE_DIMENSIONS);
    invoke(
        &mut core,
        "renderbufferStorage",
        &[
            number(RENDERBUFFER),
            number(DEPTH_COMPONENT16),
            number(2),
            number(2),
        ],
    );
    texture_image(&mut core, 4, 4, RGBA);
    assert_eq!(status(&mut core), INCOMPLETE_DIMENSIONS);
    invoke(
        &mut core,
        "renderbufferStorage",
        &[
            number(RENDERBUFFER),
            number(DEPTH_COMPONENT16),
            number(4),
            number(4),
        ],
    );
    let current = core.target_snapshot(true).unwrap();
    assert_eq!((previous.width, previous.height), (2, 2));
    assert_eq!(previous.depth.unwrap().storage_generation, 1);
    assert_eq!((current.width, current.height), (4, 4));
    assert_eq!(current.depth.unwrap().storage_generation, 4);
    assert_eq!(current.color.unwrap().texture, texture);
    let (before, _) = core.take_resource_operations();
    let generations: Vec<_> = before
        .iter()
        .filter_map(|operation| match operation {
            ResourceOperation::RetireRenderbuffer {
                renderbuffer,
                storage_generation,
            } if *renderbuffer == depth => Some(*storage_generation),
            _ => None,
        })
        .collect();
    assert_eq!(generations, [1, 2, 3]);
}

#[test]
fn target_validation_and_color_writes_are_ordered_and_version_bounded() {
    let mut core = context();
    let default = core.target_snapshot(false).unwrap();
    assert!(default.is_default);
    assert_eq!((default.width, default.height), (64, 32));
    create_framebuffer(&mut core);
    assert!(core.target_snapshot(false).is_none());
    assert_eq!(core.get_error(), NO_ERROR);
    assert!(core.target_snapshot(true).is_none());
    assert_eq!(core.get_error(), INVALID_FRAMEBUFFER_OPERATION);
    let texture = create_texture(&mut core, 2, 2, RGBA);
    attach_color(&mut core, Some(texture));
    core.take_resource_operations();
    let target = core.target_snapshot(true).unwrap();
    assert_eq!(core.framebuffer_color_texture(), Some(texture));
    assert!(core.prepare_color_write(&target));
    core.finish_color_write(&target);
    let (before, after) = core.take_resource_operations();
    assert!(before.is_empty());
    assert!(
        matches!(&after[0], ResourceOperation::WriteTexture { version, previous }
        if previous.content_version == 1 && version.content_version == 2 && version.storage_generation == previous.storage_generation)
    );
    assert!(!core.prepare_color_write(&target));
    assert_eq!(core.get_error(), INVALID_OPERATION);
    let index = core.texture_index(texture, true).unwrap();
    core.render.textures.slots[index]
        .value
        .as_mut()
        .unwrap()
        .images[0]
        .content_version = MAX_SAFE_VERSION;
    let maximum = core.target_snapshot(true).unwrap();
    assert!(!core.prepare_color_write(&maximum));
    assert_eq!(core.get_error(), OUT_OF_MEMORY);
    assert!(core.take_resource_operations().1.is_empty());
}

#[test]
fn an_aborted_output_packet_rolls_back_only_unencoded_color_writes() {
    let mut core = context();
    complete_target(&mut core);
    let target = core.target_snapshot(true).unwrap();
    assert!(core.prepare_color_write(&target));
    core.finish_color_write(&target);
    let (_, after) = core.take_resource_operations();
    assert_ne!(core.target_snapshot(true).unwrap().color, target.color);
    core.rollback_resource_writes(&after);
    assert_eq!(core.target_snapshot(true).unwrap().color, target.color);
    assert_eq!(core.get_error(), NO_ERROR);
}

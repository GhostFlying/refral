use super::*;

fn number(value: i64) -> Argument {
    Argument::Number(value as f64)
}

fn request(x: i32, y: i32, width: i32, height: i32, byte_length: u64) -> Vec<Argument> {
    vec![
        number(x as i64),
        number(y as i64),
        number(width as i64),
        number(height as i64),
        number(RGBA as i64),
        number(UNSIGNED_BYTE as i64),
        Argument::Text("Uint8Array".encode_utf16().collect()),
        Argument::Number(byte_length as f64),
    ]
}

fn plan(core: &mut ContextCore, args: &[Argument]) -> ReadPixelsPlan {
    match core.render_invoke("prepareReadPixels", args) {
        Reply::ReadPixelsPlan(plan) => plan,
        _ => panic!("expected readPixels plan"),
    }
}

fn context() -> ContextCore {
    let mut core = ContextCore::new(1, 1024 * 1024).unwrap();
    core.render.surface = [5, 3];
    core
}

#[test]
fn clips_all_edges_and_preserves_destination_offsets() {
    let mut core = context();
    let actual = plan(&mut core, &request(-1, -2, 8, 7, 224));
    assert_eq!(actual.target.width, 5);
    assert_eq!(actual.target.height, 3);
    assert!(actual.target.is_default);
    assert_eq!((actual.source_x, actual.source_y), (0, 0));
    assert_eq!((actual.copy_width, actual.copy_height), (5, 3));
    assert_eq!(actual.destination_offset, 68);
    assert_eq!(actual.destination_stride, 32);
    assert_eq!(actual.required_bytes, 224);
    let actual = plan(&mut core, &request(3, 1, 5, 4, 80));
    assert_eq!((actual.source_x, actual.source_y), (3, 1));
    assert_eq!((actual.copy_width, actual.copy_height), (2, 2));
    assert_eq!(actual.destination_offset, 0);
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn packing_requires_only_the_final_rows_pixel_bytes() {
    let mut core = context();
    for (alignment, stride, required) in [(1, 12, 24), (2, 12, 24), (4, 12, 24), (8, 16, 28)] {
        core.render_invoke("pixelStorei", &[number(0x0d05), number(alignment)]);
        let actual = plan(&mut core, &request(0, 0, 3, 2, required));
        assert_eq!(actual.destination_stride, stride);
        assert_eq!(actual.required_bytes, required);
        assert!(matches!(
            core.render_invoke("prepareReadPixels", &request(0, 0, 3, 2, required - 1)),
            Reply::Null
        ));
        assert_eq!(core.get_error(), INVALID_OPERATION);
    }
}

#[test]
fn outside_and_empty_rectangles_never_produce_a_destination_copy() {
    let mut core = context();
    for (x, y, width, height, bytes) in [
        (-8, 0, 3, 2, 24),
        (9, 0, 3, 2, 24),
        (0, -8, 3, 2, 24),
        (0, 9, 3, 2, 24),
        (0, 0, 0, 2, 0),
        (0, 0, 3, 0, 0),
        (i32::MIN, i32::MIN, i32::MAX, 1, i32::MAX as u64 * 4),
    ] {
        let actual = plan(&mut core, &request(x, y, width, height, bytes));
        assert_eq!((actual.copy_width, actual.copy_height), (0, 0));
        assert_eq!(actual.destination_offset, 0);
    }
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn validates_destinations_and_safe_span_without_changing_packing() {
    let mut core = context();
    for (index, value, error) in [
        (2, number(-1), INVALID_VALUE),
        (3, number(-1), INVALID_VALUE),
        (6, Argument::Null, INVALID_VALUE),
        (
            6,
            Argument::Text("Uint16Array".encode_utf16().collect()),
            INVALID_OPERATION,
        ),
        (
            6,
            Argument::Text("DataView".encode_utf16().collect()),
            INVALID_OPERATION,
        ),
        (7, number(3), INVALID_OPERATION),
        (7, Argument::Number(f64::NAN), INVALID_OPERATION),
    ] {
        let mut args = request(0, 0, 1, 1, 4);
        args[index] = value;
        assert!(matches!(
            core.render_invoke("prepareReadPixels", &args),
            Reply::Null
        ));
        assert_eq!(core.get_error(), error);
        assert_eq!(
            plan(&mut core, &request(0, 0, 1, 1, 4)).destination_stride,
            4
        );
    }
    assert!(matches!(
        core.render_invoke(
            "prepareReadPixels",
            &request(0, 0, i32::MAX, i32::MAX, MAX_SAFE_VERSION)
        ),
        Reply::Null
    ));
    assert_eq!(core.get_error(), INVALID_OPERATION);
    let mut args = request(0, 0, 1, 1, 4);
    args[6] = Argument::Text("Uint8ClampedArray".encode_utf16().collect());
    assert_eq!(plan(&mut core, &args).required_bytes, 4);
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn distinguishes_unsupported_pairs_from_invalid_enums() {
    let mut core = context();
    for (format, data_type, error) in [
        (0x1906, UNSIGNED_BYTE, INVALID_OPERATION),
        (0x1907, UNSIGNED_BYTE, INVALID_OPERATION),
        (RGBA, 0x8363, INVALID_OPERATION),
        (RGBA, 0x8033, INVALID_OPERATION),
        (RGBA, 0x8034, INVALID_OPERATION),
        (0x1909, UNSIGNED_BYTE, INVALID_ENUM),
        (0x190a, UNSIGNED_BYTE, INVALID_ENUM),
        (0, UNSIGNED_BYTE, INVALID_ENUM),
        (RGBA, FLOAT, INVALID_ENUM),
        (RGBA, 0x1403, INVALID_ENUM),
        (RGBA, 0, INVALID_ENUM),
    ] {
        let mut args = request(0, 0, 1, 1, 4);
        args[4] = number(format as i64);
        args[5] = number(data_type as i64);
        assert!(matches!(
            core.render_invoke("prepareReadPixels", &args),
            Reply::Null
        ));
        assert_eq!(core.get_error(), error);
    }
}

#[test]
fn validation_precedence_preserves_errors_before_target_checks() {
    let mut core = context();
    let mut args = request(0, 0, 1, 1, 4);
    args[4] = number(0);
    args[6] = Argument::Null;
    assert!(matches!(
        core.render_invoke("prepareReadPixels", &args),
        Reply::Null
    ));
    assert_eq!(core.get_error(), INVALID_VALUE);
    let mut args = request(0, 0, -1, 1, 4);
    args[4] = number(0);
    assert!(matches!(
        core.render_invoke("prepareReadPixels", &args),
        Reply::Null
    ));
    assert_eq!(core.get_error(), INVALID_ENUM);
    let framebuffer = match core.render_invoke("createFramebuffer", &[]) {
        Reply::Handle(handle) => handle,
        _ => panic!("expected framebuffer"),
    };
    core.render_invoke(
        "bindFramebuffer",
        &[number(0x8d40), Argument::Handle(framebuffer)],
    );
    assert!(matches!(
        core.render_invoke("prepareReadPixels", &request(0, 0, 1, 1, 3)),
        Reply::Null
    ));
    assert_eq!(core.get_error(), INVALID_OPERATION);
    assert!(matches!(
        core.render_invoke("prepareReadPixels", &request(0, 0, -1, 1, 4)),
        Reply::Null
    ));
    assert_eq!(core.get_error(), INVALID_VALUE);
}

#[test]
fn incomplete_targets_have_distinct_read_and_query_errors() {
    let mut core = context();
    let framebuffer = match core.render_invoke("createFramebuffer", &[]) {
        Reply::Handle(handle) => handle,
        _ => panic!("expected framebuffer"),
    };
    core.render_invoke(
        "bindFramebuffer",
        &[number(0x8d40), Argument::Handle(framebuffer)],
    );
    assert!(matches!(
        core.render_invoke("prepareReadPixels", &request(0, 0, 1, 1, 4)),
        Reply::Null
    ));
    assert_eq!(core.get_error(), INVALID_FRAMEBUFFER_OPERATION);
    for parameter in [
        IMPLEMENTATION_COLOR_READ_FORMAT,
        IMPLEMENTATION_COLOR_READ_TYPE,
    ] {
        assert!(matches!(
            core.render_invoke("getParameter", &[number(parameter as i64)]),
            Reply::Null
        ));
        assert_eq!(core.get_error(), INVALID_OPERATION);
    }
    core.render_invoke("bindFramebuffer", &[number(0x8d40), Argument::Null]);
    for (parameter, expected) in [
        (IMPLEMENTATION_COLOR_READ_FORMAT, RGBA),
        (IMPLEMENTATION_COLOR_READ_TYPE, UNSIGNED_BYTE),
    ] {
        assert!(matches!(
            core.render_invoke("getParameter", &[number(parameter as i64)]),
            Reply::Number(value) if value == expected as f64
        ));
    }
    assert_eq!(core.get_error(), NO_ERROR);
}

#[test]
fn loss_disables_plans_and_implementation_queries() {
    let mut core = context();
    core.mark_lost();
    assert_eq!(core.get_error(), CONTEXT_LOST_WEBGL);
    assert!(matches!(
        core.render_invoke("prepareReadPixels", &request(0, 0, 1, 1, 4)),
        Reply::Null
    ));
    assert!(matches!(
        core.render_invoke(
            "getParameter",
            &[number(IMPLEMENTATION_COLOR_READ_FORMAT as i64)]
        ),
        Reply::Null
    ));
    assert_eq!(core.get_error(), NO_ERROR);
}

use super::*;

// Keep the selector order in sync with the versioned JS adapter.
pub(super) const SCALARS: [&str; 8] = [
    "uniform1f",
    "uniform2f",
    "uniform3f",
    "uniform4f",
    "uniform1i",
    "uniform2i",
    "uniform3i",
    "uniform4i",
];
pub(super) const LISTS: [&str; 11] = [
    "uniform1fv",
    "uniform2fv",
    "uniform3fv",
    "uniform4fv",
    "uniform1iv",
    "uniform2iv",
    "uniform3iv",
    "uniform4iv",
    "uniformMatrix2fv",
    "uniformMatrix3fv",
    "uniformMatrix4fv",
];

pub(super) fn object(kind: ObjectKind, context_id: u32, slot: u32, generation: u32) -> Argument {
    if context_id == 0 && slot == 0 && generation == 0 {
        return Argument::Null;
    }
    Argument::Handle(ObjectHandle {
        kind,
        context_id,
        slot,
        generation,
    })
}

#[no_mangle]
pub extern "C" fn rf_direct_command_protocol_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn rf_direct_scalar(
    opcode: u32,
    context: u32,
    slot: u32,
    generation: u32,
    x: f64,
    y: f64,
    z: f64,
    w: f64,
) -> u32 {
    with_state(0, |state| {
        if let Some(operation) = SCALARS.get(opcode as usize) {
            let args = [
                object(ObjectKind::UniformLocation, context, slot, generation),
                Argument::Number(x),
                Argument::Number(y),
                Argument::Number(z),
                Argument::Number(w),
            ];
            state.core.render_invoke(operation, &args);
            return 0;
        }
        match opcode {
            8 => u32::from(matches!(
                state.core.render_invoke(
                    "bindVertexArrayOES",
                    &[object(ObjectKind::VertexArray, context, slot, generation)],
                ),
                Reply::Boolean(true)
            )),
            9 => {
                state.core.render_invoke(
                    "setSurfaceSize",
                    &[Argument::Number(x), Argument::Number(y)],
                );
                0
            }
            _ => 0,
        }
    })
}

#[no_mangle]
pub extern "C" fn rf_direct_list_prepare(length: u32) -> usize {
    with_state(0, |state| {
        let transport = &mut state.render_transport;
        transport.direct_list_prepared = false;
        if !length.is_multiple_of(4) {
            return 0;
        }
        if !reserve(&mut transport.direct_list, length as usize) {
            state.core.record_error(OUT_OF_MEMORY);
            return 0;
        }
        transport.direct_list_prepared = true;
        transport.direct_list.as_mut_ptr() as usize
    })
}

pub(super) fn read_list<T>(bytes: &[u8], decode: impl Fn([u8; 4]) -> T) -> Option<Vec<T>> {
    let mut values = Vec::new();
    values.try_reserve_exact(bytes.len() / 4).ok()?;
    values.extend(
        bytes
            .chunks_exact(4)
            .map(|word| decode(word.try_into().unwrap())),
    );
    Some(values)
}

#[no_mangle]
pub extern "C" fn rf_direct_list_commit(
    opcode: u32,
    context: u32,
    slot: u32,
    generation: u32,
    transpose: u32,
) {
    with_state((), |state| {
        let transport = &mut state.render_transport;
        if !std::mem::take(&mut transport.direct_list_prepared) {
            return;
        }
        let Some(operation) = LISTS.get(opcode as usize) else {
            return;
        };
        let value = if (4..8).contains(&opcode) {
            read_list(&transport.direct_list, i32::from_le_bytes).map(Argument::Ints)
        } else {
            read_list(&transport.direct_list, f32::from_le_bytes).map(Argument::Floats)
        };
        let Some(value) = value else {
            state.core.record_error(OUT_OF_MEMORY);
            return;
        };
        let handle = object(ObjectKind::UniformLocation, context, slot, generation);
        if opcode >= 8 {
            state.core.render_invoke(
                operation,
                &[handle, Argument::Boolean(transpose != 0), value],
            );
        } else {
            state.core.render_invoke(operation, &[handle, value]);
        }
    });
}

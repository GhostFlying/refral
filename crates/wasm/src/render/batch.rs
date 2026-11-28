use super::{direct, *};
use refral_core::ResourceOperation;

const INPUT_BYTES: usize = 128 * 1024;
const INVALID_BATCH: u32 = u32::MAX;
const VAO: u32 = 19;
const USE_PROGRAM: u32 = 20;
const DRAW_ARRAYS: u32 = 21;
const NUMERIC: [&str; 8] = [
    "drawArrays",
    "drawElements",
    "clear",
    "viewport",
    "scissor",
    "enable",
    "disable",
    "frontFace",
];

#[derive(Default)]
pub(super) struct Storage {
    input: Vec<u8>,
    output: Vec<u8>,
    resource_owners: Vec<ResourceOperation>,
}

struct Input<'a>(&'a [u8]);

impl<'a> Input<'a> {
    fn take(&mut self, size: usize) -> Option<&'a [u8]> {
        let (head, tail) = self.0.split_at_checked(size)?;
        self.0 = tail;
        Some(head)
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }

    fn numbers(&mut self) -> Option<[Argument; 4]> {
        let bytes = self.take(32)?;
        Some(std::array::from_fn(|idx| {
            Argument::Number(f64::from_le_bytes(
                bytes[idx * 8..idx * 8 + 8].try_into().unwrap(),
            ))
        }))
    }

    fn handle(&mut self, kind: ObjectKind) -> Option<Argument> {
        Some(direct::object(kind, self.u32()?, self.u32()?, self.u32()?))
    }
}

#[no_mangle]
pub extern "C" fn rf_batch_protocol_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn rf_batch_numeric_opcode_max() -> u32 {
    DRAW_ARRAYS + NUMERIC.len() as u32 - 1
}

#[no_mangle]
pub extern "C" fn rf_batch_input_pointer() -> usize {
    with_state(0, |state| {
        let input = &mut state.render_transport.batch.input;
        if input.is_empty() && !reserve(input, INPUT_BYTES) {
            state.core.record_error(OUT_OF_MEMORY);
            return 0;
        }
        input.as_mut_ptr() as usize
    })
}

#[no_mangle]
pub extern "C" fn rf_batch_output_pointer() -> usize {
    with_state(0, |state| {
        state.render_transport.batch.output.as_ptr() as usize
    })
}

#[no_mangle]
pub extern "C" fn rf_batch_run(length: u32, width: u32, height: u32) -> u32 {
    rf_batch_run_compact(length, width, height, 0)
}

#[no_mangle]
pub extern "C" fn rf_batch_run_compact(
    length: u32,
    width: u32,
    height: u32,
    supported: u32,
) -> u32 {
    with_state(INVALID_BATCH, |state| {
        let storage = &mut state.render_transport.batch;
        storage.output.clear();
        storage.resource_owners.clear();
        let Some(data) = storage.input.get(..length as usize) else {
            return INVALID_BATCH;
        };
        let mut input = Input(data);
        let core = &mut state.core;
        core.render_invoke(
            "setSurfaceSize",
            &[
                Argument::Number(width.into()),
                Argument::Number(height.into()),
            ],
        );
        let mut previous = DrawReferences {
            enabled: supported & RASTER_REFERENCE,
            ..Default::default()
        };
        while !input.0.is_empty() {
            let Some(opcode) = input.u32() else {
                return INVALID_BATCH;
            };
            let Some(reply) = dispatch(core, &mut input, opcode) else {
                return INVALID_BATCH;
            };
            if !publish(
                core,
                &mut storage.output,
                &mut storage.resource_owners,
                reply,
                opcode,
                &mut previous,
            ) {
                return INVALID_BATCH;
            }
        }
        u32::try_from(storage.output.len()).unwrap_or(INVALID_BATCH)
    })
}

fn dispatch(core: &mut BufferCore, input: &mut Input<'_>, opcode: u32) -> Option<Reply> {
    match opcode {
        0..=7 => {
            let location = input.handle(ObjectKind::UniformLocation)?;
            let [x, y, z, w] = input.numbers()?;
            Some(core.render_invoke(direct::SCALARS[opcode as usize], &[location, x, y, z, w]))
        }
        8..=18 => {
            let location = input.handle(ObjectKind::UniformLocation)?;
            let transpose = input.u32()? != 0;
            let count = input.u32()? as usize;
            let bytes = input.take(count.checked_mul(4)?)?;
            let index = (opcode - 8) as usize;
            let value = if (4..8).contains(&index) {
                direct::read_list(bytes, i32::from_le_bytes).map(Argument::Ints)
            } else {
                direct::read_list(bytes, f32::from_le_bytes).map(Argument::Floats)
            };
            let Some(value) = value else {
                core.record_error(OUT_OF_MEMORY);
                return Some(Reply::Null);
            };
            let operation = direct::LISTS[index];
            if index >= 8 {
                Some(
                    core.render_invoke(operation, &[location, Argument::Boolean(transpose), value]),
                )
            } else {
                Some(core.render_invoke(operation, &[location, value]))
            }
        }
        VAO => Some(core.render_invoke(
            "bindVertexArrayOES",
            &[input.handle(ObjectKind::VertexArray)?],
        )),
        USE_PROGRAM => {
            Some(core.render_invoke("useProgram", &[input.handle(ObjectKind::Program)?]))
        }
        _ => {
            let index = opcode.checked_sub(DRAW_ARRAYS)? as usize;
            Some(core.render_invoke(NUMERIC.get(index)?, &input.numbers()?))
        }
    }
}

// Reply records are ordered around the GL command. Resource payload pointers
// stay valid until the next batch drain, even if a later command retires storage.
fn publish(
    core: &mut BufferCore,
    output: &mut Vec<u8>,
    owners: &mut Vec<ResourceOperation>,
    reply: Reply,
    opcode: u32,
    previous: &mut DrawReferences,
) -> bool {
    let (before, after) = core.take_resource_operations();
    let releases = core.take_artifact_releases();
    if matches!(reply, Reply::Null)
        && opcode != VAO
        && before.is_empty()
        && after.is_empty()
        && releases.is_empty()
    {
        return true;
    }
    let capacity = reply_capacity(&reply)
        .and_then(|size| size.checked_add(crate::resources::capacity(&before)?))
        .and_then(|size| size.checked_add(crate::resources::capacity(&after)?))
        .and_then(|size| size.checked_add(releases.len().checked_mul(4)?))
        .and_then(|size| size.checked_add(40));
    if capacity.is_none_or(|size| output.try_reserve(size).is_err())
        || owners.try_reserve(before.len() + after.len()).is_err()
    {
        core.rollback_resource_writes(&after);
        core.record_error(OUT_OF_MEMORY);
        return false;
    }

    if !before.is_empty() {
        record(output, 3, |bytes| crate::resources::encode(bytes, &before));
    }
    match reply {
        Reply::Draw(snapshot) => record(output, 1, |bytes| encode_draw(bytes, snapshot, previous)),
        Reply::Clear(snapshot) => record(output, 2, |bytes| encode_clear(bytes, snapshot)),
        Reply::Boolean(accepted) if opcode == VAO => {
            record(output, 5, |bytes| u32_value(bytes, u32::from(accepted)));
        }
        Reply::Null if opcode == VAO => record(output, 5, |bytes| u32_value(bytes, 0)),
        Reply::Null => {}
        _ => return false,
    }
    if !after.is_empty() {
        record(output, 3, |bytes| crate::resources::encode(bytes, &after));
    }
    if !releases.is_empty() {
        record(output, 4, |bytes| {
            for id in releases {
                u32_value(bytes, id);
            }
        });
    }
    owners.extend(before);
    owners.extend(after);
    true
}

fn record(output: &mut Vec<u8>, kind: u32, encode: impl FnOnce(&mut Vec<u8>)) {
    u32_value(output, kind);
    let length = output.len();
    u32_value(output, 0);
    let payload = output.len();
    encode(output);
    let size = (output.len() - payload) as u32;
    output[length..payload].copy_from_slice(&size.to_le_bytes());
}

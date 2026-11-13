//! Private, versioned, single-context ABI for the browser adapter.
//!
//! Upload pointers always refer to the Rust-owned input arena. No export accepts
//! a caller-supplied pointer or dereferences memory selected by the caller.

use std::cell::RefCell;

use refral_core::{BufferCore, BufferHandle, BufferSnapshot, INVALID_OPERATION, OUT_OF_MEMORY};

const ABI_VERSION: u32 = 1;

enum Upload {
    Data { target: u32, usage: u32 },
    SubData { target: u32, offset: f64 },
}

struct State {
    core: BufferCore,
    input: Vec<u8>,
    pending_upload: Option<Upload>,
    result_handle: Option<BufferHandle>,
    snapshot: Option<BufferSnapshot>,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

fn with_state<R>(fallback: R, call: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|state| match state.borrow_mut().as_mut() {
        Some(state) => call(state),
        None => fallback,
    })
}

fn handle(context_id: u32, slot: u32, generation: u32) -> Option<BufferHandle> {
    if context_id == 0 && slot == 0 && generation == 0 {
        None
    } else {
        Some(BufferHandle {
            context_id,
            slot,
            generation,
        })
    }
}

fn prepare_input(state: &mut State, length: usize, upload: Upload) -> u32 {
    state.pending_upload = None;
    state.input.clear();
    if state.input.try_reserve_exact(length).is_err() {
        state.core.record_error(OUT_OF_MEMORY);
        return 0;
    }
    state.input.resize(length, 0);
    state.pending_upload = Some(upload);
    1
}

#[no_mangle]
pub extern "C" fn rf_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn rf_init(context_id: u32, max_buffer_bytes: f64) -> u32 {
    if !max_buffer_bytes.is_finite()
        || max_buffer_bytes < 0.0
        || max_buffer_bytes.fract() != 0.0
        || max_buffer_bytes > 9_007_199_254_740_991.0
    {
        return 0;
    }
    let Ok(core) = BufferCore::new(context_id, max_buffer_bytes as u64) else {
        return 0;
    };
    STATE.with(|state| {
        *state.borrow_mut() = Some(State {
            core,
            input: Vec::new(),
            pending_upload: None,
            result_handle: None,
            snapshot: None,
        });
    });
    1
}

#[no_mangle]
pub extern "C" fn rf_create_buffer() -> u32 {
    with_state(0, |state| {
        state.result_handle = state.core.create_buffer();
        state.result_handle.map_or(0, |handle| handle.slot)
    })
}

#[no_mangle]
pub extern "C" fn rf_result_generation() -> u32 {
    with_state(0, |state| {
        state.result_handle.map_or(0, |handle| handle.generation)
    })
}

#[no_mangle]
pub extern "C" fn rf_bind_buffer(target: u32, context_id: u32, slot: u32, generation: u32) {
    with_state((), |state| {
        state
            .core
            .bind_buffer(target, handle(context_id, slot, generation));
    });
}

#[no_mangle]
pub extern "C" fn rf_buffer_data_size(target: u32, size: f64, usage: u32) {
    with_state((), |state| {
        state.pending_upload = None;
        state.core.buffer_data_size(target, size, usage);
    });
}

#[no_mangle]
pub extern "C" fn rf_buffer_data_null(target: u32, usage: u32) {
    with_state((), |state| {
        state.pending_upload = None;
        state.core.buffer_data_null(target, usage);
    });
}

#[no_mangle]
pub extern "C" fn rf_buffer_data_prepare(target: u32, length: f64, usage: u32) -> u32 {
    with_state(0, |state| {
        state.pending_upload = None;
        if !state.core.prepare_buffer_data(target, length, usage) {
            return 0;
        }
        prepare_input(state, length as usize, Upload::Data { target, usage })
    })
}

#[no_mangle]
pub extern "C" fn rf_buffer_sub_data_prepare(target: u32, offset: f64, length: f64) -> u32 {
    with_state(0, |state| {
        state.pending_upload = None;
        // Reject nonrepresentable lengths before casting or allocating. A
        // length above the budget cannot fit any live Buffer in this context.
        let length = if length.is_finite() && length >= 0.0 && length.fract() == 0.0 {
            if length <= state.core.max_buffer_bytes() as f64 && length <= usize::MAX as f64 {
                length as usize
            } else {
                usize::MAX
            }
        } else {
            usize::MAX
        };
        if !state.core.prepare_buffer_sub_data(target, offset, length) {
            return 0;
        }
        prepare_input(state, length, Upload::SubData { target, offset })
    })
}

#[no_mangle]
pub extern "C" fn rf_input_pointer() -> usize {
    with_state(0, |state| {
        if state.pending_upload.is_some() {
            state.input.as_ptr() as usize
        } else {
            0
        }
    })
}

#[no_mangle]
pub extern "C" fn rf_input_length() -> usize {
    with_state(0, |state| state.input.len())
}

#[no_mangle]
pub extern "C" fn rf_upload_commit() {
    with_state((), |state| match state.pending_upload.take() {
        Some(Upload::Data { target, usage }) => {
            state.core.buffer_data_bytes(target, &state.input, usage);
        }
        Some(Upload::SubData { target, offset }) => {
            state.core.buffer_sub_data(target, offset, &state.input);
        }
        None => state.core.record_error(INVALID_OPERATION),
    });
}

#[no_mangle]
pub extern "C" fn rf_get_buffer_parameter(target: u32, parameter: u32) -> f64 {
    with_state(-1.0, |state| {
        state
            .core
            .get_buffer_parameter(target, parameter)
            .map_or(-1.0, |value| value as f64)
    })
}

#[no_mangle]
pub extern "C" fn rf_get_binding(parameter: u32) -> u32 {
    with_state(0, |state| {
        state.result_handle = state.core.get_binding(parameter);
        state.result_handle.map_or(0, |handle| handle.slot)
    })
}

#[no_mangle]
pub extern "C" fn rf_delete_buffer(context_id: u32, slot: u32, generation: u32) {
    with_state((), |state| {
        state
            .core
            .delete_buffer(handle(context_id, slot, generation));
    });
}

#[no_mangle]
pub extern "C" fn rf_is_buffer(context_id: u32, slot: u32, generation: u32) -> u32 {
    with_state(0, |state| {
        u32::from(state.core.is_buffer(handle(context_id, slot, generation)))
    })
}

#[no_mangle]
pub extern "C" fn rf_get_error() -> u32 {
    with_state(0, |state| state.core.get_error())
}

#[no_mangle]
pub extern "C" fn rf_mark_lost() -> u32 {
    with_state(0, |state| {
        state.pending_upload = None;
        state.input.clear();
        state.snapshot = None;
        u32::from(state.core.mark_lost())
    })
}

#[no_mangle]
pub extern "C" fn rf_is_context_lost() -> u32 {
    with_state(1, |state| u32::from(state.core.is_context_lost()))
}

#[no_mangle]
pub extern "C" fn rf_inspect_buffer(context_id: u32, slot: u32, generation: u32) -> u32 {
    with_state(0, |state| {
        state.snapshot = handle(context_id, slot, generation)
            .and_then(|handle| state.core.inspect_buffer(handle));
        u32::from(state.snapshot.is_some())
    })
}

#[no_mangle]
pub extern "C" fn rf_snapshot_pointer() -> usize {
    with_state(0, |state| {
        state
            .snapshot
            .as_ref()
            .map_or(0, |snapshot| snapshot.data.as_ptr() as usize)
    })
}

#[no_mangle]
pub extern "C" fn rf_snapshot_length() -> usize {
    with_state(0, |state| {
        state
            .snapshot
            .as_ref()
            .map_or(0, |snapshot| snapshot.metadata.byte_length)
    })
}

#[no_mangle]
pub extern "C" fn rf_snapshot_usage() -> u32 {
    with_state(0, |state| {
        state
            .snapshot
            .as_ref()
            .map_or(0, |snapshot| snapshot.metadata.usage)
    })
}

#[no_mangle]
pub extern "C" fn rf_snapshot_storage_generation() -> f64 {
    with_state(0.0, |state| {
        state
            .snapshot
            .as_ref()
            .map_or(0.0, |snapshot| snapshot.metadata.storage_generation as f64)
    })
}

#[no_mangle]
pub extern "C" fn rf_snapshot_content_version() -> f64 {
    with_state(0.0, |state| {
        state
            .snapshot
            .as_ref()
            .map_or(0.0, |snapshot| snapshot.metadata.content_version as f64)
    })
}

#[no_mangle]
pub extern "C" fn rf_dispose() {
    with_state((), |state| {
        state.core.dispose();
        state.pending_upload = None;
        state.input = Vec::new();
        state.snapshot = None;
        state.result_handle = None;
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use refral_core::{
        ARRAY_BUFFER, ARRAY_BUFFER_BINDING, BUFFER_SIZE, CONTEXT_LOST_WEBGL, INVALID_ENUM,
        INVALID_VALUE, NO_ERROR, STATIC_DRAW,
    };

    fn bind_new() -> u32 {
        assert_eq!(rf_init(1, 1024.0), 1);
        let slot = rf_create_buffer();
        rf_bind_buffer(ARRAY_BUFFER, 1, slot, rf_result_generation());
        slot
    }

    #[test]
    fn initializes_and_rejects_invalid_limits() {
        assert_eq!(rf_abi_version(), 1);
        assert_eq!(rf_init(0, 1.0), 0);
        assert_eq!(rf_init(1, f64::NAN), 0);
        assert_eq!(rf_init(1, -1.0), 0);
        assert_eq!(rf_init(1, 1.5), 0);
        assert_eq!(rf_init(1, 9_007_199_254_740_992.0), 0);
        assert_eq!(rf_init(1, u32::MAX as f64 + 1.0), 1);
        assert_eq!(rf_init(1, 0.0), 1);
    }

    #[test]
    fn stages_in_owned_memory_and_copies_inspection_results() {
        let slot = bind_new();
        assert_eq!(rf_buffer_data_prepare(ARRAY_BUFFER, 4.0, STATIC_DRAW), 1);
        STATE.with(|state| {
            state
                .borrow_mut()
                .as_mut()
                .unwrap()
                .input
                .copy_from_slice(&[1, 2, 3, 4]);
        });
        assert_ne!(rf_input_pointer(), 0);
        assert_eq!(rf_input_length(), 4);
        rf_upload_commit();
        assert_eq!(rf_inspect_buffer(1, slot, 1), 1);
        assert_eq!(rf_snapshot_length(), 4);
        assert_eq!(rf_snapshot_storage_generation(), 1.0);
        assert_eq!(rf_snapshot_content_version(), 1.0);
        assert_eq!(rf_buffer_sub_data_prepare(ARRAY_BUFFER, 1.0, 2.0), 1);
        STATE.with(|state| {
            state
                .borrow_mut()
                .as_mut()
                .unwrap()
                .input
                .copy_from_slice(&[8, 9]);
        });
        rf_upload_commit();
        STATE.with(|state| {
            let state = state.borrow();
            assert_eq!(
                state.as_ref().unwrap().snapshot.as_ref().unwrap().data,
                [1, 2, 3, 4]
            );
        });
        assert_eq!(rf_inspect_buffer(1, slot, 1), 1);
        STATE.with(|state| {
            let state = state.borrow();
            assert_eq!(
                state.as_ref().unwrap().snapshot.as_ref().unwrap().data,
                [1, 8, 9, 4]
            );
        });
        assert_eq!(rf_snapshot_content_version(), 2.0);
        assert_eq!(rf_get_error(), NO_ERROR);
    }

    #[test]
    fn invalid_abi_calls_report_errors_and_preserve_state() {
        let slot = bind_new();
        rf_buffer_data_size(ARRAY_BUFFER, 4.0, STATIC_DRAW);
        assert_eq!(
            rf_buffer_data_prepare(ARRAY_BUFFER, f64::INFINITY, STATIC_DRAW),
            0
        );
        assert_eq!(rf_get_error(), INVALID_VALUE);
        assert_eq!(rf_buffer_data_prepare(ARRAY_BUFFER, -1.0, 0), 0);
        assert_eq!(rf_get_error(), INVALID_ENUM);
        assert_eq!(rf_buffer_sub_data_prepare(ARRAY_BUFFER, 0.0, f64::NAN), 0);
        assert_eq!(rf_get_error(), INVALID_VALUE);
        assert_eq!(rf_buffer_sub_data_prepare(ARRAY_BUFFER, 4.0, 0.0), 1);
        rf_upload_commit();
        assert_eq!(rf_get_error(), NO_ERROR);
        assert_eq!(rf_buffer_sub_data_prepare(ARRAY_BUFFER, 5.0, 0.0), 0);
        assert_eq!(rf_get_error(), INVALID_VALUE);
        rf_upload_commit();
        assert_eq!(rf_get_error(), INVALID_OPERATION);
        rf_bind_buffer(0, 2, slot, 1);
        assert_eq!(rf_get_error(), INVALID_OPERATION);
        assert_eq!(rf_get_binding(ARRAY_BUFFER_BINDING), slot);
        assert_eq!(rf_get_buffer_parameter(ARRAY_BUFFER, BUFFER_SIZE), 4.0);
    }

    #[test]
    fn lost_and_disposed_calls_are_neutral() {
        let slot = bind_new();
        assert_eq!(rf_mark_lost(), 1);
        assert_eq!(rf_mark_lost(), 0);
        assert_eq!(rf_get_error(), CONTEXT_LOST_WEBGL);
        assert_eq!(rf_create_buffer(), 0);
        assert_eq!(rf_buffer_data_prepare(ARRAY_BUFFER, 2.0, STATIC_DRAW), 0);
        assert_eq!(rf_is_buffer(1, slot, 1), 0);
        assert_eq!(rf_inspect_buffer(1, slot, 1), 0);
        assert_eq!(rf_get_buffer_parameter(ARRAY_BUFFER, BUFFER_SIZE), -1.0);
        rf_dispose();
        assert_eq!(rf_is_context_lost(), 1);
        assert_eq!(rf_get_error(), NO_ERROR);
    }
}

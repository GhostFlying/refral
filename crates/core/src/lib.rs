pub const NO_ERROR: u32 = 0;
pub const INVALID_ENUM: u32 = 0x0500;
pub const INVALID_VALUE: u32 = 0x0501;
pub const INVALID_OPERATION: u32 = 0x0502;
pub const OUT_OF_MEMORY: u32 = 0x0505;
pub const CONTEXT_LOST_WEBGL: u32 = 0x9242;
pub const ARRAY_BUFFER: u32 = 0x8892;
pub const ELEMENT_ARRAY_BUFFER: u32 = 0x8893;
pub const ARRAY_BUFFER_BINDING: u32 = 0x8894;
pub const ELEMENT_ARRAY_BUFFER_BINDING: u32 = 0x8895;
pub const STATIC_DRAW: u32 = 0x88e4;
pub const DYNAMIC_DRAW: u32 = 0x88e8;
pub const STREAM_DRAW: u32 = 0x88e0;
pub const BUFFER_SIZE: u32 = 0x8764;
pub const BUFFER_USAGE: u32 = 0x8765;

const MAX_SAFE_VERSION: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BufferHandle {
    pub context_id: u32,
    pub slot: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BufferMetadata {
    pub handle: BufferHandle,
    pub byte_length: usize,
    pub usage: u32,
    pub storage_generation: u64,
    pub content_version: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub struct BufferSnapshot {
    pub metadata: BufferMetadata,
    pub data: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum InitializationError {
    InvalidContextId,
    InvalidBufferLimit,
}

struct Buffer {
    target: Option<u32>,
    usage: u32,
    storage_generation: u64,
    content_version: u64,
    data: Vec<u8>,
}

impl Buffer {
    fn new() -> Self {
        Self {
            target: None,
            usage: STATIC_DRAW,
            storage_generation: 0,
            content_version: 0,
            data: Vec::new(),
        }
    }
}

struct Slot {
    generation: u32,
    buffer: Option<Buffer>,
}

pub struct BufferCore {
    context_id: u32,
    max_buffer_bytes: u64,
    slots: Vec<Slot>,
    array_binding: Option<BufferHandle>,
    element_binding: Option<BufferHandle>,
    errors: [u32; 4],
    error_count: usize,
    lost: bool,
    lost_error_pending: bool,
}

impl BufferCore {
    pub fn new(context_id: u32, max_buffer_bytes: u64) -> Result<Self, InitializationError> {
        if context_id == 0 {
            return Err(InitializationError::InvalidContextId);
        }
        if max_buffer_bytes > MAX_SAFE_VERSION {
            return Err(InitializationError::InvalidBufferLimit);
        }
        Ok(Self {
            context_id,
            max_buffer_bytes,
            slots: Vec::new(),
            array_binding: None,
            element_binding: None,
            errors: [NO_ERROR; 4],
            error_count: 0,
            lost: false,
            lost_error_pending: false,
        })
    }

    pub fn context_id(&self) -> u32 {
        self.context_id
    }

    pub fn max_buffer_bytes(&self) -> u64 {
        self.max_buffer_bytes
    }

    pub fn record_error(&mut self, error: u32) {
        if self.lost
            || !matches!(
                error,
                INVALID_ENUM | INVALID_VALUE | INVALID_OPERATION | OUT_OF_MEMORY
            )
        {
            return;
        }
        if self.errors[..self.error_count].contains(&error) {
            return;
        }
        self.errors[self.error_count] = error;
        self.error_count += 1;
    }

    pub fn get_error(&mut self) -> u32 {
        if self.lost_error_pending {
            self.lost_error_pending = false;
            return CONTEXT_LOST_WEBGL;
        }
        if self.error_count == 0 {
            return NO_ERROR;
        }
        let error = self.errors[0];
        self.errors.copy_within(1..self.error_count, 0);
        self.error_count -= 1;
        error
    }

    pub fn is_context_lost(&self) -> bool {
        self.lost
    }

    pub fn mark_lost(&mut self) -> bool {
        if self.lost {
            return false;
        }
        self.lost = true;
        self.lost_error_pending = true;
        self.error_count = 0;
        self.array_binding = None;
        self.element_binding = None;
        for slot in &mut self.slots {
            slot.buffer = None;
        }
        true
    }

    pub fn dispose(&mut self) {
        self.mark_lost();
        self.slots = Vec::new();
    }

    pub fn create_buffer(&mut self) -> Option<BufferHandle> {
        if self.lost {
            return None;
        }
        for (index, slot) in self.slots.iter_mut().enumerate() {
            if slot.buffer.is_none() && slot.generation < u32::MAX {
                slot.generation += 1;
                slot.buffer = Some(Buffer::new());
                return Some(BufferHandle {
                    context_id: self.context_id,
                    slot: index as u32 + 1,
                    generation: slot.generation,
                });
            }
        }
        if self.slots.len() >= u32::MAX as usize || self.slots.try_reserve(1).is_err() {
            self.record_error(OUT_OF_MEMORY);
            return None;
        }
        self.slots.push(Slot {
            generation: 1,
            buffer: Some(Buffer::new()),
        });
        Some(BufferHandle {
            context_id: self.context_id,
            slot: self.slots.len() as u32,
            generation: 1,
        })
    }

    fn live_index(&self, handle: BufferHandle) -> Option<usize> {
        if self.lost || handle.context_id != self.context_id || handle.slot == 0 {
            return None;
        }
        let index = handle.slot as usize - 1;
        let slot = self.slots.get(index)?;
        (slot.generation == handle.generation && slot.buffer.is_some()).then_some(index)
    }

    fn valid_index(&mut self, handle: BufferHandle) -> Option<usize> {
        let index = self.live_index(handle);
        if index.is_none() {
            self.record_error(INVALID_OPERATION);
        }
        index
    }

    fn bound_index(&mut self, target: u32) -> Option<usize> {
        if self.lost {
            return None;
        }
        let binding = match target {
            ARRAY_BUFFER => self.array_binding,
            ELEMENT_ARRAY_BUFFER => self.element_binding,
            _ => {
                self.record_error(INVALID_ENUM);
                return None;
            }
        };
        match binding {
            Some(handle) => self.valid_index(handle),
            None => {
                self.record_error(INVALID_OPERATION);
                None
            }
        }
    }

    pub fn bind_buffer(&mut self, target: u32, handle: Option<BufferHandle>) {
        if self.lost {
            return;
        }
        let index = match handle {
            Some(handle) => match self.valid_index(handle) {
                Some(index) => Some(index),
                None => return,
            },
            None => None,
        };
        if target != ARRAY_BUFFER && target != ELEMENT_ARRAY_BUFFER {
            self.record_error(INVALID_ENUM);
            return;
        }
        if let Some(index) = index {
            let buffer = self.slots[index].buffer.as_mut().expect("live Buffer slot");
            if buffer.target.is_some() && buffer.target != Some(target) {
                self.record_error(INVALID_OPERATION);
                return;
            }
            buffer.target = Some(target);
        }
        if target == ARRAY_BUFFER {
            self.array_binding = handle;
        } else {
            self.element_binding = handle;
        }
    }

    pub fn get_binding(&mut self, parameter: u32) -> Option<BufferHandle> {
        if self.lost {
            return None;
        }
        match parameter {
            ARRAY_BUFFER_BINDING => self.array_binding,
            ELEMENT_ARRAY_BUFFER_BINDING => self.element_binding,
            _ => {
                self.record_error(INVALID_ENUM);
                None
            }
        }
    }

    pub fn is_buffer(&self, handle: Option<BufferHandle>) -> bool {
        handle
            .and_then(|handle| self.live_index(handle))
            .and_then(|index| self.slots[index].buffer.as_ref())
            .is_some_and(|buffer| buffer.target.is_some())
    }

    pub fn delete_buffer(&mut self, handle: Option<BufferHandle>) {
        if self.lost {
            return;
        }
        let Some(handle) = handle else {
            return;
        };
        if handle.context_id != self.context_id || handle.slot == 0 || handle.generation == 0 {
            self.record_error(INVALID_OPERATION);
            return;
        }
        let Some(slot) = self.slots.get_mut(handle.slot as usize - 1) else {
            self.record_error(INVALID_OPERATION);
            return;
        };
        if handle.generation > slot.generation {
            self.record_error(INVALID_OPERATION);
            return;
        }
        if handle.generation < slot.generation || slot.buffer.is_none() {
            return;
        }
        slot.buffer = None;
        if self.array_binding == Some(handle) {
            self.array_binding = None;
        }
        if self.element_binding == Some(handle) {
            self.element_binding = None;
        }
    }

    fn data_target(&mut self, target: u32, size: Option<f64>, usage: u32) -> Option<usize> {
        let index = self.bound_index(target)?;
        if !matches!(usage, STATIC_DRAW | DYNAMIC_DRAW | STREAM_DRAW) {
            self.record_error(INVALID_ENUM);
            return None;
        }
        let Some(size) = size else {
            self.record_error(INVALID_VALUE);
            return None;
        };
        if !size.is_finite() || size < 0.0 || size.fract() != 0.0 || size > MAX_SAFE_VERSION as f64
        {
            self.record_error(INVALID_VALUE);
            return None;
        }
        if size > self.max_buffer_bytes as f64 || size > usize::MAX as f64 {
            self.record_error(OUT_OF_MEMORY);
            return None;
        }
        Some(index)
    }

    pub fn prepare_buffer_data(&mut self, target: u32, size: f64, usage: u32) -> bool {
        self.data_target(target, Some(size), usage).is_some()
    }

    fn versions(&mut self, index: usize, replace_storage: bool) -> Option<(u64, u64)> {
        let buffer = self.slots[index].buffer.as_ref()?;
        let storage = buffer.storage_generation + u64::from(replace_storage);
        let content = buffer.content_version + 1;
        if storage > MAX_SAFE_VERSION || content > MAX_SAFE_VERSION {
            self.record_error(OUT_OF_MEMORY);
            return None;
        }
        Some((storage, content))
    }

    fn replace_data(&mut self, index: usize, data: Vec<u8>, usage: u32, versions: (u64, u64)) {
        let buffer = self.slots[index]
            .buffer
            .as_mut()
            .expect("validated Buffer slot");
        buffer.data = data;
        buffer.usage = usage;
        buffer.storage_generation = versions.0;
        buffer.content_version = versions.1;
    }

    pub fn buffer_data_size(&mut self, target: u32, size: f64, usage: u32) {
        let Some(index) = self.data_target(target, Some(size), usage) else {
            return;
        };
        let Some(versions) = self.versions(index, true) else {
            return;
        };
        let mut data = Vec::new();
        if data.try_reserve_exact(size as usize).is_err() {
            self.record_error(OUT_OF_MEMORY);
            return;
        }
        data.resize(size as usize, 0);
        self.replace_data(index, data, usage, versions);
    }

    pub fn buffer_data_bytes(&mut self, target: u32, source: &[u8], usage: u32) {
        let Some(index) = self.data_target(target, Some(source.len() as f64), usage) else {
            return;
        };
        let Some(versions) = self.versions(index, true) else {
            return;
        };
        let Some(data) = copy_bytes(source) else {
            self.record_error(OUT_OF_MEMORY);
            return;
        };
        self.replace_data(index, data, usage, versions);
    }

    pub fn buffer_data_null(&mut self, target: u32, usage: u32) {
        self.data_target(target, None, usage);
    }

    fn sub_data_target(
        &mut self,
        target: u32,
        offset: f64,
        length: usize,
    ) -> Option<(usize, usize)> {
        let index = self.bound_index(target)?;
        let byte_length = self.slots[index].buffer.as_ref()?.data.len();
        if !offset.is_finite()
            || offset < 0.0
            || offset.fract() != 0.0
            || offset > byte_length as f64
            || length > byte_length - offset as usize
        {
            self.record_error(INVALID_VALUE);
            return None;
        }
        Some((index, offset as usize))
    }

    pub fn prepare_buffer_sub_data(&mut self, target: u32, offset: f64, length: usize) -> bool {
        self.sub_data_target(target, offset, length).is_some()
    }

    pub fn buffer_sub_data(&mut self, target: u32, offset: f64, source: &[u8]) {
        let Some((index, offset)) = self.sub_data_target(target, offset, source.len()) else {
            return;
        };
        if source.is_empty() {
            return;
        }
        let Some(versions) = self.versions(index, false) else {
            return;
        };
        let buffer = self.slots[index]
            .buffer
            .as_ref()
            .expect("validated Buffer slot");
        let Some(mut replacement) = copy_bytes(&buffer.data) else {
            self.record_error(OUT_OF_MEMORY);
            return;
        };
        replacement[offset..offset + source.len()].copy_from_slice(source);
        let usage = buffer.usage;
        self.replace_data(index, replacement, usage, versions);
    }

    pub fn get_buffer_parameter(&mut self, target: u32, parameter: u32) -> Option<usize> {
        let index = self.bound_index(target)?;
        let buffer = self.slots[index].buffer.as_ref()?;
        match parameter {
            BUFFER_SIZE => Some(buffer.data.len()),
            BUFFER_USAGE => Some(buffer.usage as usize),
            _ => {
                self.record_error(INVALID_ENUM);
                None
            }
        }
    }

    pub fn inspect_buffer(&self, handle: BufferHandle) -> Option<BufferSnapshot> {
        let index = self.live_index(handle)?;
        let buffer = self.slots[index].buffer.as_ref()?;
        Some(BufferSnapshot {
            metadata: BufferMetadata {
                handle,
                byte_length: buffer.data.len(),
                usage: buffer.usage,
                storage_generation: buffer.storage_generation,
                content_version: buffer.content_version,
            },
            data: copy_bytes(&buffer.data)?,
        })
    }
}

fn copy_bytes(source: &[u8]) -> Option<Vec<u8>> {
    let mut copy = Vec::new();
    copy.try_reserve_exact(source.len()).ok()?;
    copy.extend_from_slice(source);
    Some(copy)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bound_core() -> (BufferCore, BufferHandle) {
        let mut core = BufferCore::new(1, 1024).unwrap();
        let handle = core.create_buffer().unwrap();
        assert!(!core.is_buffer(Some(handle)));
        core.bind_buffer(ARRAY_BUFFER, Some(handle));
        (core, handle)
    }

    #[test]
    fn consumes_upload_bytes_and_returns_owned_snapshots() {
        let (mut core, handle) = bound_core();
        let mut input = [90, 1, 2, 3, 4, 91];
        core.buffer_data_bytes(ARRAY_BUFFER, &input[1..5], STATIC_DRAW);
        input.fill(0);
        let snapshot = core.inspect_buffer(handle).unwrap();
        assert_eq!(snapshot.data, [1, 2, 3, 4]);
        assert_eq!(snapshot.metadata.storage_generation, 1);
        assert_eq!(snapshot.metadata.content_version, 1);
        assert_eq!(core.get_error(), NO_ERROR);
    }

    #[test]
    fn subrange_updates_preserve_previous_snapshots_and_storage_generation() {
        let (mut core, handle) = bound_core();
        core.buffer_data_bytes(ARRAY_BUFFER, &[1, 2, 3, 4], DYNAMIC_DRAW);
        let earlier = core.inspect_buffer(handle).unwrap();
        core.buffer_sub_data(ARRAY_BUFFER, 1.0, &[8, 9]);
        let updated = core.inspect_buffer(handle).unwrap();
        assert_eq!(earlier.data, [1, 2, 3, 4]);
        assert_eq!(updated.data, [1, 8, 9, 4]);
        assert_eq!(
            updated.metadata.storage_generation,
            earlier.metadata.storage_generation
        );
        assert_eq!(
            updated.metadata.content_version,
            earlier.metadata.content_version + 1
        );
        assert_eq!(updated.metadata.usage, DYNAMIC_DRAW);
    }

    #[test]
    fn zero_length_updates_leave_versions_unchanged() {
        let (mut core, handle) = bound_core();
        core.buffer_data_size(ARRAY_BUFFER, 4.0, STATIC_DRAW);
        let before = core.inspect_buffer(handle).unwrap();
        core.buffer_sub_data(ARRAY_BUFFER, 4.0, &[]);
        assert_eq!(core.inspect_buffer(handle).unwrap(), before);
        assert_eq!(core.get_error(), NO_ERROR);
    }

    #[test]
    fn allocation_replaces_storage_with_zeroed_contents() {
        let (mut core, handle) = bound_core();
        core.buffer_data_bytes(ARRAY_BUFFER, &[7, 8], STATIC_DRAW);
        core.buffer_data_size(ARRAY_BUFFER, 8.0, STREAM_DRAW);
        let snapshot = core.inspect_buffer(handle).unwrap();
        assert_eq!(snapshot.data, [0; 8]);
        assert_eq!(snapshot.metadata.storage_generation, 2);
        assert_eq!(snapshot.metadata.content_version, 2);
        assert_eq!(
            core.get_buffer_parameter(ARRAY_BUFFER, BUFFER_USAGE),
            Some(STREAM_DRAW as usize)
        );
    }

    #[test]
    fn invalid_calls_preserve_state_and_data() {
        let (mut core, handle) = bound_core();
        core.buffer_data_bytes(ARRAY_BUFFER, &[1, 2, 3, 4], STATIC_DRAW);
        let before = core.inspect_buffer(handle).unwrap();
        core.buffer_sub_data(ARRAY_BUFFER, 3.0, &[8, 9]);
        assert_eq!(core.get_error(), INVALID_VALUE);
        core.buffer_data_size(ARRAY_BUFFER, 4.0, 0);
        assert_eq!(core.get_error(), INVALID_ENUM);
        core.bind_buffer(ELEMENT_ARRAY_BUFFER, Some(handle));
        assert_eq!(core.get_error(), INVALID_OPERATION);
        assert_eq!(core.get_binding(ARRAY_BUFFER_BINDING), Some(handle));
        assert_eq!(core.get_binding(ELEMENT_ARRAY_BUFFER_BINDING), None);
        assert_eq!(core.inspect_buffer(handle).unwrap(), before);
    }

    #[test]
    fn capacity_and_numeric_failures_are_atomic() {
        let (mut core, handle) = bound_core();
        core.buffer_data_size(ARRAY_BUFFER, 4.0, STATIC_DRAW);
        let before = core.inspect_buffer(handle).unwrap();
        for size in [-1.0, 0.5, f64::NAN, f64::INFINITY] {
            core.buffer_data_size(ARRAY_BUFFER, size, STATIC_DRAW);
            assert_eq!(core.get_error(), INVALID_VALUE);
        }
        core.buffer_data_size(ARRAY_BUFFER, 1025.0, STATIC_DRAW);
        assert_eq!(core.get_error(), OUT_OF_MEMORY);
        assert_eq!(core.inspect_buffer(handle).unwrap(), before);
    }

    #[test]
    fn foreign_and_stale_handles_cannot_change_bindings() {
        let (mut core, handle) = bound_core();
        let foreign = BufferHandle {
            context_id: 2,
            ..handle
        };
        core.bind_buffer(ARRAY_BUFFER, Some(foreign));
        assert_eq!(core.get_error(), INVALID_OPERATION);
        assert!(!core.is_buffer(Some(foreign)));
        assert_eq!(core.get_binding(ARRAY_BUFFER_BINDING), Some(handle));
        core.delete_buffer(Some(handle));
        let replacement = core.create_buffer().unwrap();
        assert_eq!(replacement.slot, handle.slot);
        assert!(replacement.generation > handle.generation);
        core.bind_buffer(ARRAY_BUFFER, Some(handle));
        assert_eq!(core.get_error(), INVALID_OPERATION);
        core.delete_buffer(Some(handle));
        assert_eq!(core.get_error(), NO_ERROR);
        core.bind_buffer(ARRAY_BUFFER, Some(replacement));
        assert!(core.is_buffer(Some(replacement)));
    }

    #[test]
    fn deletion_clears_bindings_and_preserves_owned_snapshots() {
        let (mut core, handle) = bound_core();
        core.buffer_data_bytes(ARRAY_BUFFER, &[1, 2, 3], STATIC_DRAW);
        let before = core.inspect_buffer(handle).unwrap();
        core.delete_buffer(Some(handle));
        core.delete_buffer(Some(handle));
        assert_eq!(core.get_binding(ARRAY_BUFFER_BINDING), None);
        assert!(!core.is_buffer(Some(handle)));
        assert!(core.inspect_buffer(handle).is_none());
        assert_eq!(before.data, [1, 2, 3]);
        assert_eq!(core.get_error(), NO_ERROR);
    }

    #[test]
    fn inspection_and_object_queries_preserve_errors() {
        let (mut core, handle) = bound_core();
        core.bind_buffer(0, Some(handle));
        assert!(core.inspect_buffer(handle).is_some());
        assert!(!core.is_buffer(None));
        assert_eq!(core.get_error(), INVALID_ENUM);
        assert_eq!(core.get_error(), NO_ERROR);
    }

    #[test]
    fn errors_are_deduplicated_and_consumed_in_order() {
        let (mut core, _) = bound_core();
        core.record_error(INVALID_VALUE);
        core.record_error(INVALID_VALUE);
        core.record_error(INVALID_OPERATION);
        assert_eq!(core.get_error(), INVALID_VALUE);
        assert_eq!(core.get_error(), INVALID_OPERATION);
        assert_eq!(core.get_error(), NO_ERROR);
    }

    #[test]
    fn context_loss_returns_neutral_results_and_one_loss_error() {
        let (mut core, handle) = bound_core();
        assert!(core.mark_lost());
        assert!(!core.mark_lost());
        core.bind_buffer(0, Some(handle));
        core.buffer_data_size(ARRAY_BUFFER, 8.0, STATIC_DRAW);
        assert!(core.create_buffer().is_none());
        assert!(!core.is_buffer(Some(handle)));
        assert!(core.get_binding(ARRAY_BUFFER_BINDING).is_none());
        assert!(core
            .get_buffer_parameter(ARRAY_BUFFER, BUFFER_SIZE)
            .is_none());
        assert!(core.inspect_buffer(handle).is_none());
        assert_eq!(core.get_error(), CONTEXT_LOST_WEBGL);
        assert_eq!(core.get_error(), NO_ERROR);
        core.dispose();
        assert_eq!(core.get_error(), NO_ERROR);
    }
}

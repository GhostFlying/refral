use super::*;

#[derive(Default)]
pub(crate) struct VertexArray {
    pub(crate) element: Option<BufferHandle>,
    pub(crate) attributes: [VertexAttribute; 16],
    bound_once: bool,
}

#[derive(Default)]
pub(crate) struct VertexArrays {
    default: VertexArray,
    slots: Vec<RenderSlot<VertexArray>>,
    bound: Option<ObjectHandle>,
    enabled: bool,
}

impl VertexArrays {
    pub(crate) fn current(&self) -> &VertexArray {
        match self.bound {
            Some(handle) => self.slots[handle.slot as usize - 1].value.as_ref().unwrap(),
            None => &self.default,
        }
    }

    pub(crate) fn current_mut(&mut self) -> &mut VertexArray {
        match self.bound {
            Some(handle) => self.slots[handle.slot as usize - 1].value.as_mut().unwrap(),
            None => &mut self.default,
        }
    }
}

impl ContextCore {
    pub(super) fn vertex_array_invoke(
        &mut self,
        operation: &str,
        args: &[Argument],
    ) -> Option<Reply> {
        let arrays = &mut self.render.arrays;
        let handle = args.first().and_then(Argument::handle);
        let kind = ObjectKind::VertexArray;
        let reply = match operation {
            "enableVertexArrayObjects" => {
                arrays.enabled = true;
                Reply::Null
            }
            "getParameter"
                if arrays.enabled && args.first().map(Argument::number) == Some(0x85b5 as f64) =>
            {
                arrays.bound.map_or(Reply::Null, Reply::Handle)
            }
            "createVertexArrayOES" => match insert(
                &mut arrays.slots,
                VertexArray::default(),
                kind,
                self.context_id,
            ) {
                Some(handle) => Reply::Handle(handle),
                None => {
                    self.record_error(OUT_OF_MEMORY);
                    Reply::Null
                }
            },
            "isVertexArrayOES" => {
                let known =
                    handle.and_then(|h| slot_index(&arrays.slots, h, kind, self.context_id));
                Reply::Boolean(
                    known.is_some_and(|i| arrays.slots[i].value.as_ref().unwrap().bound_once),
                )
            }
            "bindVertexArrayOES" => {
                if let Some(h) = handle {
                    if let Some(i) = slot_index(&arrays.slots, h, kind, self.context_id) {
                        arrays.slots[i].value.as_mut().unwrap().bound_once = true;
                        arrays.bound = Some(h);
                    } else {
                        self.record_error(INVALID_OPERATION);
                        return Some(Reply::Boolean(false));
                    }
                } else {
                    arrays.bound = None;
                }
                Reply::Boolean(true)
            }
            "deleteVertexArrayOES" => {
                if let Some(h) = handle {
                    if let Some(i) = slot_index(&arrays.slots, h, kind, self.context_id) {
                        if arrays.bound == Some(h) {
                            arrays.bound = None;
                        }
                        let array = arrays.slots[i].value.take().unwrap();
                        self.replace_vertex_reference(array.element, None);
                        for attribute in array.attributes {
                            self.replace_vertex_reference(attribute.buffer, None);
                        }
                    } else {
                        let already_deleted = h.context_id == self.context_id
                            && h.kind == kind
                            && h.generation > 0
                            && h.slot
                                .checked_sub(1)
                                .and_then(|i| arrays.slots.get(i as usize))
                                .is_some_and(|slot| h.generation <= slot.generation);
                        if !already_deleted {
                            self.record_error(INVALID_OPERATION);
                        }
                    }
                }
                Reply::Null
            }
            _ => return None,
        };
        Some(reply)
    }
}

use super::*;

#[cfg(test)]
#[path = "framebuffer_tests.rs"]
mod tests;

const FRAMEBUFFER: u32 = 0x8d40;
const RENDERBUFFER: u32 = 0x8d41;
const FRAMEBUFFER_BINDING: u32 = 0x8ca6;
const RENDERBUFFER_BINDING: u32 = 0x8ca7;
const COLOR_ATTACHMENT0: u32 = 0x8ce0;
const DEPTH_ATTACHMENT: u32 = 0x8d00;
const TEXTURE_2D: u32 = 0x0de1;
const TEXTURE: u32 = 0x1702;
const RGBA: u32 = 0x1908;
const RGB: u32 = 0x1907;
const RGBA4: u32 = 0x8056;
const DEPTH_COMPONENT16: u32 = 0x81a5;
const COMPLETE: u32 = 0x8cd5;
const INCOMPLETE_ATTACHMENT: u32 = 0x8cd6;
const MISSING_ATTACHMENT: u32 = 0x8cd7;
const INCOMPLETE_DIMENSIONS: u32 = 0x8cd9;
const UNSUPPORTED: u32 = 0x8cdd;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DepthAttachment {
    pub renderbuffer: ObjectHandle,
    pub storage_generation: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TargetSnapshot {
    pub width: u32,
    pub height: u32,
    pub is_default: bool,
    pub color: Option<TextureVersion>,
    pub depth: Option<DepthAttachment>,
}

#[derive(Default)]
struct Framebuffer {
    bound: bool,
    color: Option<ObjectHandle>,
    depth: Option<ObjectHandle>,
}

struct Renderbuffer {
    bound: bool,
    deleted: bool,
    references: usize,
    width: u32,
    height: u32,
    format: u32,
    storage_generation: u64,
}
impl Default for Renderbuffer {
    fn default() -> Self {
        Self {
            bound: false,
            deleted: false,
            references: 0,
            width: 0,
            height: 0,
            format: RGBA4,
            storage_generation: 0,
        }
    }
}

#[derive(Default)]
pub(super) struct FramebufferState {
    slots: Vec<RenderSlot<Framebuffer>>,
    renderbuffers: Vec<RenderSlot<Renderbuffer>>,
    bound: Option<ObjectHandle>,
    renderbuffer: Option<ObjectHandle>,
}

fn deletion_index<T>(
    slots: &[RenderSlot<T>],
    handle: ObjectHandle,
    kind: ObjectKind,
    context_id: u32,
) -> Result<Option<usize>, ()> {
    if handle.kind != kind
        || handle.context_id != context_id
        || handle.slot == 0
        || handle.generation == 0
    {
        return Err(());
    }
    let index = handle.slot as usize - 1;
    let Some(slot) = slots.get(index) else {
        return Err(());
    };
    if handle.generation > slot.generation {
        return Err(());
    }
    Ok((handle.generation == slot.generation && slot.value.is_some()).then_some(index))
}

impl ContextCore {
    fn framebuffer_index(&mut self, handle: ObjectHandle) -> Option<usize> {
        let index = slot_index(
            &self.render.framebuffers.slots,
            handle,
            ObjectKind::Framebuffer,
            self.context_id,
        );
        if index.is_none() {
            self.record_error(INVALID_OPERATION);
        }
        index
    }

    fn renderbuffer_index(&mut self, handle: ObjectHandle, allow_deleted: bool) -> Option<usize> {
        let index = slot_index(
            &self.render.framebuffers.renderbuffers,
            handle,
            ObjectKind::Renderbuffer,
            self.context_id,
        )
        .filter(|index| {
            allow_deleted
                || !self.render.framebuffers.renderbuffers[*index]
                    .value
                    .as_ref()
                    .unwrap()
                    .deleted
        });
        if index.is_none() {
            self.record_error(INVALID_OPERATION);
        }
        index
    }

    fn framebuffer_argument(&mut self, argument: &Argument) -> Option<Option<ObjectHandle>> {
        match argument {
            Argument::Null => Some(None),
            Argument::Handle(handle) => Some(Some(*handle)),
            _ => {
                self.record_error(INVALID_OPERATION);
                None
            }
        }
    }

    fn bound_framebuffer(&mut self, target: u32) -> Option<usize> {
        if target != FRAMEBUFFER {
            self.record_error(INVALID_ENUM);
            return None;
        }
        let Some(handle) = self.render.framebuffers.bound else {
            self.record_error(INVALID_OPERATION);
            return None;
        };
        self.framebuffer_index(handle)
    }

    fn reserve_framebuffer_operations(&mut self, count: usize) -> bool {
        if self.render.textures.before.try_reserve(count).is_err() {
            self.record_error(OUT_OF_MEMORY);
            return false;
        }
        true
    }

    fn release_color_attachment(&mut self, handle: ObjectHandle) {
        let Some(index) = slot_index(
            &self.render.textures.slots,
            handle,
            ObjectKind::Texture,
            self.context_id,
        ) else {
            return;
        };
        let texture = self.render.textures.slots[index].value.as_mut().unwrap();
        debug_assert!(texture.references > 0);
        texture.references -= 1;
        self.release_texture(index);
    }

    fn release_depth_attachment(&mut self, handle: ObjectHandle) {
        let Some(index) = slot_index(
            &self.render.framebuffers.renderbuffers,
            handle,
            ObjectKind::Renderbuffer,
            self.context_id,
        ) else {
            return;
        };
        let renderbuffer = self.render.framebuffers.renderbuffers[index]
            .value
            .as_mut()
            .unwrap();
        debug_assert!(renderbuffer.references > 0);
        renderbuffer.references -= 1;
        self.release_renderbuffer(index, handle);
    }

    fn release_renderbuffer(&mut self, index: usize, handle: ObjectHandle) {
        let renderbuffer = self.render.framebuffers.renderbuffers[index]
            .value
            .as_ref()
            .unwrap();
        if !renderbuffer.deleted || renderbuffer.references != 0 {
            return;
        }
        if renderbuffer.storage_generation > 0 {
            self.render
                .textures
                .before
                .push(ResourceOperation::RetireDepth {
                    renderbuffer: handle,
                    storage_generation: renderbuffer.storage_generation,
                });
        }
        self.render.framebuffers.renderbuffers[index].value = None;
    }

    pub(super) fn framebuffer_color_texture(&self) -> Option<ObjectHandle> {
        let handle = self.render.framebuffers.bound?;
        let index = slot_index(
            &self.render.framebuffers.slots,
            handle,
            ObjectKind::Framebuffer,
            self.context_id,
        )?;
        self.render.framebuffers.slots[index].value.as_ref()?.color
    }

    pub(super) fn detach_bound_texture(&mut self, handle: ObjectHandle) {
        let Some(framebuffer) = self.render.framebuffers.bound else {
            return;
        };
        let Some(index) = slot_index(
            &self.render.framebuffers.slots,
            framebuffer,
            ObjectKind::Framebuffer,
            self.context_id,
        ) else {
            return;
        };
        if self.render.framebuffers.slots[index]
            .value
            .as_ref()
            .unwrap()
            .color
            != Some(handle)
        {
            return;
        }
        self.render.framebuffers.slots[index]
            .value
            .as_mut()
            .unwrap()
            .color = None;
        if let Some(index) = slot_index(
            &self.render.textures.slots,
            handle,
            ObjectKind::Texture,
            self.context_id,
        ) {
            let texture = self.render.textures.slots[index].value.as_mut().unwrap();
            debug_assert!(texture.references > 0);
            texture.references -= 1;
        }
    }

    fn framebuffer_status(&self) -> u32 {
        let Some(handle) = self.render.framebuffers.bound else {
            return COMPLETE;
        };
        let Some(index) = slot_index(
            &self.render.framebuffers.slots,
            handle,
            ObjectKind::Framebuffer,
            self.context_id,
        ) else {
            return MISSING_ATTACHMENT;
        };
        let framebuffer = self.render.framebuffers.slots[index]
            .value
            .as_ref()
            .unwrap();
        if framebuffer.color.is_none() && framebuffer.depth.is_none() {
            return MISSING_ATTACHMENT;
        }
        let color = if let Some(handle) = framebuffer.color {
            let Some(index) = slot_index(
                &self.render.textures.slots,
                handle,
                ObjectKind::Texture,
                self.context_id,
            ) else {
                return INCOMPLETE_ATTACHMENT;
            };
            let Some(storage) = self.render.textures.slots[index]
                .value
                .as_ref()
                .unwrap()
                .storage
            else {
                return INCOMPLETE_ATTACHMENT;
            };
            if storage.width == 0 || storage.height == 0 {
                return INCOMPLETE_ATTACHMENT;
            }
            if storage.format != RGBA && storage.format != RGB {
                return INCOMPLETE_ATTACHMENT;
            }
            Some(storage)
        } else {
            None
        };
        if let Some(handle) = framebuffer.depth {
            let Some(index) = slot_index(
                &self.render.framebuffers.renderbuffers,
                handle,
                ObjectKind::Renderbuffer,
                self.context_id,
            ) else {
                return INCOMPLETE_ATTACHMENT;
            };
            let depth = self.render.framebuffers.renderbuffers[index]
                .value
                .as_ref()
                .unwrap();
            if depth.width == 0
                || depth.height == 0
                || depth.storage_generation == 0
                || depth.format != DEPTH_COMPONENT16
            {
                return INCOMPLETE_ATTACHMENT;
            }
            if color.is_some_and(|color| color.width != depth.width || color.height != depth.height)
            {
                return INCOMPLETE_DIMENSIONS;
            }
        }
        if color.is_none_or(|color| color.format != RGBA) {
            return UNSUPPORTED;
        }
        COMPLETE
    }

    pub(super) fn target_snapshot(&mut self, report_error: bool) -> Option<TargetSnapshot> {
        if self.framebuffer_status() != COMPLETE {
            if report_error {
                self.record_error(INVALID_FRAMEBUFFER_OPERATION);
            }
            return None;
        }
        let Some(handle) = self.render.framebuffers.bound else {
            return Some(TargetSnapshot {
                width: self.render.surface[0],
                height: self.render.surface[1],
                is_default: true,
                color: None,
                depth: None,
            });
        };
        let index = slot_index(
            &self.render.framebuffers.slots,
            handle,
            ObjectKind::Framebuffer,
            self.context_id,
        )?;
        let framebuffer = self.render.framebuffers.slots[index]
            .value
            .as_ref()
            .unwrap();
        let color_handle = framebuffer.color?;
        let color_index = slot_index(
            &self.render.textures.slots,
            color_handle,
            ObjectKind::Texture,
            self.context_id,
        )?;
        let color = self.render.textures.slots[color_index]
            .value
            .as_ref()?
            .storage?;
        let depth = framebuffer.depth.and_then(|handle| {
            let index = slot_index(
                &self.render.framebuffers.renderbuffers,
                handle,
                ObjectKind::Renderbuffer,
                self.context_id,
            )?;
            Some(DepthAttachment {
                renderbuffer: handle,
                storage_generation: self.render.framebuffers.renderbuffers[index]
                    .value
                    .as_ref()?
                    .storage_generation,
            })
        });
        Some(TargetSnapshot {
            width: color.width,
            height: color.height,
            is_default: false,
            color: Some(self.texture_version(color_index)),
            depth,
        })
    }

    pub(super) fn prepare_color_write(&mut self, target: &TargetSnapshot) -> bool {
        let Some(version) = target.color else {
            return true;
        };
        let Some(index) = self.texture_index(version.texture, true) else {
            return false;
        };
        if self.texture_version(index) != version {
            self.record_error(INVALID_OPERATION);
            return false;
        }
        if version.content_version == MAX_SAFE_VERSION
            || self.render.textures.after.try_reserve(1).is_err()
        {
            self.record_error(OUT_OF_MEMORY);
            return false;
        }
        true
    }

    pub(super) fn finish_color_write(&mut self, target: &TargetSnapshot) {
        let Some(previous) = target.color else {
            return;
        };
        let Some(index) = slot_index(
            &self.render.textures.slots,
            previous.texture,
            ObjectKind::Texture,
            self.context_id,
        ) else {
            return;
        };
        debug_assert_eq!(self.texture_version(index), previous);
        self.render.textures.slots[index]
            .value
            .as_mut()
            .unwrap()
            .content_version += 1;
        self.render
            .textures
            .after
            .push(ResourceOperation::WriteTexture {
                version: self.texture_version(index),
                previous,
            });
    }

    pub(super) fn framebuffer_query(&self, parameter: u32) -> Option<Reply> {
        match parameter {
            FRAMEBUFFER_BINDING => Some(
                self.render
                    .framebuffers
                    .bound
                    .map_or(Reply::Null, Reply::Handle),
            ),
            RENDERBUFFER_BINDING => Some(
                self.render
                    .framebuffers
                    .renderbuffer
                    .map_or(Reply::Null, Reply::Handle),
            ),
            0x0d52..=0x0d57 => Some(Reply::Number(
                self.framebuffer_component_bits(parameter) as f64
            )),
            _ => None,
        }
    }

    fn framebuffer_component_bits(&self, parameter: u32) -> u32 {
        let Some(handle) = self.render.framebuffers.bound else {
            return match parameter {
                0x0d52..=0x0d54 => 8,
                0x0d55 => {
                    if self.render.context_alpha {
                        8
                    } else {
                        0
                    }
                }
                0x0d56 => {
                    if self.render.context_depth {
                        24
                    } else {
                        0
                    }
                }
                _ => 0,
            };
        };
        let Some(index) = slot_index(
            &self.render.framebuffers.slots,
            handle,
            ObjectKind::Framebuffer,
            self.context_id,
        ) else {
            return 0;
        };
        let framebuffer = self.render.framebuffers.slots[index]
            .value
            .as_ref()
            .unwrap();
        if parameter == 0x0d56 {
            let depth = framebuffer.depth.and_then(|handle| {
                let index = slot_index(
                    &self.render.framebuffers.renderbuffers,
                    handle,
                    ObjectKind::Renderbuffer,
                    self.context_id,
                )?;
                self.render.framebuffers.renderbuffers[index].value.as_ref()
            });
            return if depth.is_some_and(|depth| {
                depth.storage_generation > 0
                    && depth.width > 0
                    && depth.height > 0
                    && depth.format == DEPTH_COMPONENT16
            }) {
                24
            } else {
                0
            };
        }
        if parameter == 0x0d57 {
            return 0;
        }
        let color = framebuffer.color.and_then(|handle| {
            let index = slot_index(
                &self.render.textures.slots,
                handle,
                ObjectKind::Texture,
                self.context_id,
            )?;
            self.render.textures.slots[index].value.as_ref()?.storage
        });
        let Some(color) = color.filter(|color| color.width > 0 && color.height > 0) else {
            return 0;
        };
        match color.format {
            RGBA => 8,
            RGB if parameter != 0x0d55 => 8,
            _ => 0,
        }
    }

    pub(super) fn framebuffer_invoke(
        &mut self,
        operation: &str,
        args: &[Argument],
    ) -> Option<Reply> {
        let arg = |index: usize| args.get(index).unwrap_or(&Argument::Null);
        match operation {
            "createFramebuffer" => {
                return Some(
                    match insert(
                        &mut self.render.framebuffers.slots,
                        Framebuffer::default(),
                        ObjectKind::Framebuffer,
                        self.context_id,
                    ) {
                        Some(handle) => Reply::Handle(handle),
                        None => {
                            self.record_error(OUT_OF_MEMORY);
                            Reply::Null
                        }
                    },
                );
            }
            "createRenderbuffer" => {
                return Some(
                    match insert(
                        &mut self.render.framebuffers.renderbuffers,
                        Renderbuffer::default(),
                        ObjectKind::Renderbuffer,
                        self.context_id,
                    ) {
                        Some(handle) => Reply::Handle(handle),
                        None => {
                            self.record_error(OUT_OF_MEMORY);
                            Reply::Null
                        }
                    },
                );
            }
            "isFramebuffer" | "isRenderbuffer" => {
                let valid = arg(0).handle().is_some_and(|handle| {
                    if operation == "isFramebuffer" {
                        slot_index(
                            &self.render.framebuffers.slots,
                            handle,
                            ObjectKind::Framebuffer,
                            self.context_id,
                        )
                        .is_some_and(|index| {
                            self.render.framebuffers.slots[index]
                                .value
                                .as_ref()
                                .unwrap()
                                .bound
                        })
                    } else {
                        slot_index(
                            &self.render.framebuffers.renderbuffers,
                            handle,
                            ObjectKind::Renderbuffer,
                            self.context_id,
                        )
                        .is_some_and(|index| {
                            let value = self.render.framebuffers.renderbuffers[index]
                                .value
                                .as_ref()
                                .unwrap();
                            value.bound && !value.deleted
                        })
                    }
                });
                return Some(Reply::Boolean(valid));
            }
            "bindFramebuffer" | "bindRenderbuffer" => {
                let Some(handle) = self.framebuffer_argument(arg(1)) else {
                    return Some(Reply::Null);
                };
                let index = if let Some(handle) = handle {
                    let index = if operation == "bindFramebuffer" {
                        self.framebuffer_index(handle)
                    } else {
                        self.renderbuffer_index(handle, false)
                    };
                    let Some(index) = index else {
                        return Some(Reply::Null);
                    };
                    Some(index)
                } else {
                    None
                };
                let target = if operation == "bindFramebuffer" {
                    FRAMEBUFFER
                } else {
                    RENDERBUFFER
                };
                if arg(0).number() as u32 != target {
                    self.record_error(INVALID_ENUM);
                    return Some(Reply::Null);
                }
                if operation == "bindFramebuffer" {
                    if let Some(index) = index {
                        self.render.framebuffers.slots[index]
                            .value
                            .as_mut()
                            .unwrap()
                            .bound = true;
                    }
                    self.render.framebuffers.bound = handle;
                } else {
                    if let Some(index) = index {
                        self.render.framebuffers.renderbuffers[index]
                            .value
                            .as_mut()
                            .unwrap()
                            .bound = true;
                    }
                    self.render.framebuffers.renderbuffer = handle;
                }
            }
            "renderbufferStorage" => {
                if arg(0).number() as u32 != RENDERBUFFER {
                    self.record_error(INVALID_ENUM);
                    return Some(Reply::Null);
                }
                let Some(handle) = self.render.framebuffers.renderbuffer else {
                    self.record_error(INVALID_OPERATION);
                    return Some(Reply::Null);
                };
                let Some(index) = self.renderbuffer_index(handle, false) else {
                    return Some(Reply::Null);
                };
                let width = arg(2).number();
                let height = arg(3).number();
                let limit = self.render.texture_dimension_limit as f64;
                if !width.is_finite()
                    || !height.is_finite()
                    || width < 0.0
                    || height < 0.0
                    || width.fract() != 0.0
                    || height.fract() != 0.0
                    || width > limit
                    || height > limit
                {
                    self.record_error(INVALID_VALUE);
                    return Some(Reply::Null);
                }
                let format = arg(1).number() as u32;
                if !matches!(format, RGBA4 | 0x8057 | 0x8d62 | DEPTH_COMPONENT16 | 0x8d48) {
                    self.record_error(INVALID_ENUM);
                    return Some(Reply::Null);
                }
                if format != DEPTH_COMPONENT16 {
                    return Some(Reply::Unsupported("non-depth renderbuffer storage"));
                }
                let generation = self.render.framebuffers.renderbuffers[index]
                    .value
                    .as_ref()
                    .unwrap()
                    .storage_generation;
                if generation == MAX_SAFE_VERSION {
                    self.record_error(OUT_OF_MEMORY);
                    return Some(Reply::Null);
                }
                if !self.reserve_framebuffer_operations(1) {
                    return Some(Reply::Null);
                }
                if generation > 0 {
                    self.render
                        .textures
                        .before
                        .push(ResourceOperation::RetireDepth {
                            renderbuffer: handle,
                            storage_generation: generation,
                        });
                }
                let renderbuffer = self.render.framebuffers.renderbuffers[index]
                    .value
                    .as_mut()
                    .unwrap();
                renderbuffer.width = width as u32;
                renderbuffer.height = height as u32;
                renderbuffer.format = format;
                renderbuffer.storage_generation += 1;
            }
            "getRenderbufferParameter" => {
                if arg(0).number() as u32 != RENDERBUFFER {
                    self.record_error(INVALID_ENUM);
                    return Some(Reply::Null);
                }
                let Some(handle) = self.render.framebuffers.renderbuffer else {
                    self.record_error(INVALID_OPERATION);
                    return Some(Reply::Null);
                };
                let Some(index) = self.renderbuffer_index(handle, false) else {
                    return Some(Reply::Null);
                };
                let value = self.render.framebuffers.renderbuffers[index]
                    .value
                    .as_ref()
                    .unwrap();
                let result = match arg(1).number() as u32 {
                    0x8d42 => value.width,
                    0x8d43 => value.height,
                    0x8d44 => value.format,
                    0x8d50 | 0x8d51 | 0x8d52 | 0x8d53 | 0x8d55 => 0,
                    0x8d54 => {
                        if value.storage_generation > 0 {
                            24
                        } else {
                            0
                        }
                    }
                    _ => {
                        self.record_error(INVALID_ENUM);
                        return Some(Reply::Null);
                    }
                };
                return Some(Reply::Number(result as f64));
            }
            "framebufferTexture2D" | "framebufferRenderbuffer" => {
                return Some(self.attach_framebuffer(operation == "framebufferTexture2D", args));
            }
            "checkFramebufferStatus" => {
                if arg(0).number() as u32 != FRAMEBUFFER {
                    self.record_error(INVALID_ENUM);
                    return Some(Reply::Number(0.0));
                }
                return Some(Reply::Number(self.framebuffer_status() as f64));
            }
            "getFramebufferAttachmentParameter" => return Some(self.attachment_parameter(args)),
            "deleteFramebuffer" | "deleteRenderbuffer" => {
                self.delete_framebuffer_object(operation == "deleteFramebuffer", arg(0));
            }
            "captureTarget" => {
                return Some(self.target_snapshot(false).map_or(
                    Reply::Unsupported("capture requires a complete framebuffer"),
                    Reply::Target,
                ))
            }
            _ => return None,
        }
        Some(Reply::Null)
    }

    fn attach_framebuffer(&mut self, texture_attachment: bool, args: &[Argument]) -> Reply {
        let arg = |index: usize| args.get(index).unwrap_or(&Argument::Null);
        let Some(handle) = self.framebuffer_argument(arg(3)) else {
            return Reply::Null;
        };
        let resource_index = if let Some(handle) = handle {
            let index = if texture_attachment {
                self.texture_index(handle, false)
            } else {
                self.renderbuffer_index(handle, false)
            };
            let Some(index) = index else {
                return Reply::Null;
            };
            let bound = if texture_attachment {
                self.render.textures.slots[index]
                    .value
                    .as_ref()
                    .unwrap()
                    .bound
            } else {
                self.render.framebuffers.renderbuffers[index]
                    .value
                    .as_ref()
                    .unwrap()
                    .bound
            };
            if !bound {
                self.record_error(INVALID_OPERATION);
                return Reply::Null;
            }
            Some(index)
        } else {
            None
        };
        let attachment = if texture_attachment {
            COLOR_ATTACHMENT0
        } else {
            DEPTH_ATTACHMENT
        };
        let resource_target = if texture_attachment {
            TEXTURE_2D
        } else {
            RENDERBUFFER
        };
        if arg(1).number() as u32 != attachment || arg(2).number() as u32 != resource_target {
            self.record_error(INVALID_ENUM);
            return Reply::Null;
        }
        if texture_attachment && arg(4).number() != 0.0 {
            self.record_error(INVALID_VALUE);
            return Reply::Null;
        }
        let Some(index) = self.bound_framebuffer(arg(0).number() as u32) else {
            return Reply::Null;
        };
        let framebuffer = self.render.framebuffers.slots[index]
            .value
            .as_ref()
            .unwrap();
        let previous = if texture_attachment {
            framebuffer.color
        } else {
            framebuffer.depth
        };
        if previous == handle {
            return Reply::Null;
        }
        if let Some(resource_index) = resource_index {
            let references = if texture_attachment {
                self.render.textures.slots[resource_index]
                    .value
                    .as_ref()
                    .unwrap()
                    .references
            } else {
                self.render.framebuffers.renderbuffers[resource_index]
                    .value
                    .as_ref()
                    .unwrap()
                    .references
            };
            if references == usize::MAX {
                self.record_error(OUT_OF_MEMORY);
                return Reply::Null;
            }
        }
        if !self.reserve_framebuffer_operations(1) {
            return Reply::Null;
        }
        if let Some(resource_index) = resource_index {
            if texture_attachment {
                self.render.textures.slots[resource_index]
                    .value
                    .as_mut()
                    .unwrap()
                    .references += 1;
            } else {
                self.render.framebuffers.renderbuffers[resource_index]
                    .value
                    .as_mut()
                    .unwrap()
                    .references += 1;
            }
        }
        let framebuffer = self.render.framebuffers.slots[index]
            .value
            .as_mut()
            .unwrap();
        if texture_attachment {
            framebuffer.color = handle;
        } else {
            framebuffer.depth = handle;
        }
        if let Some(previous) = previous {
            if texture_attachment {
                self.release_color_attachment(previous);
            } else {
                self.release_depth_attachment(previous);
            }
        }
        Reply::Null
    }

    fn attachment_parameter(&mut self, args: &[Argument]) -> Reply {
        let arg = |index: usize| args.get(index).unwrap_or(&Argument::Null);
        let attachment = arg(1).number() as u32;
        if attachment != COLOR_ATTACHMENT0 && attachment != DEPTH_ATTACHMENT {
            self.record_error(INVALID_ENUM);
            return Reply::Null;
        }
        let Some(index) = self.bound_framebuffer(arg(0).number() as u32) else {
            return Reply::Null;
        };
        let framebuffer = self.render.framebuffers.slots[index]
            .value
            .as_ref()
            .unwrap();
        let object = if attachment == COLOR_ATTACHMENT0 {
            framebuffer.color
        } else {
            framebuffer.depth
        };
        let parameter = arg(2).number() as u32;
        if parameter == 0x8cd0 {
            return Reply::Number(if object.is_none() {
                0
            } else if attachment == COLOR_ATTACHMENT0 {
                TEXTURE
            } else {
                RENDERBUFFER
            } as f64);
        }
        let Some(object) = object else {
            self.record_error(INVALID_ENUM);
            return Reply::Null;
        };
        if parameter == 0x8cd1 {
            return Reply::Handle(object);
        }
        if attachment == COLOR_ATTACHMENT0 && matches!(parameter, 0x8cd2 | 0x8cd3) {
            return Reply::Number(0.0);
        }
        self.record_error(INVALID_ENUM);
        Reply::Null
    }

    fn delete_framebuffer_object(&mut self, framebuffer: bool, argument: &Argument) {
        let Some(handle) = self.framebuffer_argument(argument) else {
            return;
        };
        let Some(handle) = handle else {
            return;
        };
        let kind = if framebuffer {
            ObjectKind::Framebuffer
        } else {
            ObjectKind::Renderbuffer
        };
        let index = if framebuffer {
            deletion_index(
                &self.render.framebuffers.slots,
                handle,
                kind,
                self.context_id,
            )
        } else {
            deletion_index(
                &self.render.framebuffers.renderbuffers,
                handle,
                kind,
                self.context_id,
            )
        };
        let index = match index {
            Ok(Some(index)) => index,
            Ok(None) => return,
            Err(()) => {
                self.record_error(INVALID_OPERATION);
                return;
            }
        };
        if framebuffer {
            if !self.reserve_framebuffer_operations(2) {
                return;
            }
            let value = self.render.framebuffers.slots[index].value.take().unwrap();
            if self.render.framebuffers.bound == Some(handle) {
                self.render.framebuffers.bound = None;
            }
            if let Some(color) = value.color {
                self.release_color_attachment(color);
            }
            if let Some(depth) = value.depth {
                self.release_depth_attachment(depth);
            }
        } else {
            if self.render.framebuffers.renderbuffers[index]
                .value
                .as_ref()
                .unwrap()
                .deleted
            {
                return;
            }
            if !self.reserve_framebuffer_operations(1) {
                return;
            }
            self.render.framebuffers.renderbuffers[index]
                .value
                .as_mut()
                .unwrap()
                .deleted = true;
            if self.render.framebuffers.renderbuffer == Some(handle) {
                self.render.framebuffers.renderbuffer = None;
            }
            if let Some(framebuffer) = self.render.framebuffers.bound {
                if let Some(framebuffer_index) = slot_index(
                    &self.render.framebuffers.slots,
                    framebuffer,
                    ObjectKind::Framebuffer,
                    self.context_id,
                ) {
                    if self.render.framebuffers.slots[framebuffer_index]
                        .value
                        .as_ref()
                        .unwrap()
                        .depth
                        == Some(handle)
                    {
                        self.render.framebuffers.slots[framebuffer_index]
                            .value
                            .as_mut()
                            .unwrap()
                            .depth = None;
                        self.release_depth_attachment(handle);
                        return;
                    }
                }
            }
            self.release_renderbuffer(index, handle);
        }
    }
}

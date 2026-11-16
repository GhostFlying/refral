use super::*;

const TEXTURE_2D: u32 = 0x0de1;
const TEXTURE0: u32 = 0x84c0;
const RGBA: u32 = 0x1908;
const RGB: u32 = 0x1907;
const ALPHA: u32 = 0x1906;
const LUMINANCE: u32 = 0x1909;
const LUMINANCE_ALPHA: u32 = 0x190a;

enum TextureUploadError {
    Invalid,
    Unsupported(&'static str),
}

impl TextureUploadError {
    fn reply(self) -> Reply {
        match self {
            Self::Invalid => Reply::Null,
            Self::Unsupported(operation) => Reply::Unsupported(operation),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TextureVersion {
    pub texture: ObjectHandle,
    pub storage_generation: u64,
    pub content_version: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TextureParameters {
    pub min_filter: u32,
    pub mag_filter: u32,
    pub wrap_s: u32,
    pub wrap_t: u32,
}
impl Default for TextureParameters {
    fn default() -> Self {
        Self {
            min_filter: 0x2702,
            mag_filter: 0x2601,
            wrap_s: 0x2901,
            wrap_t: 0x2901,
        }
    }
}
pub struct TextureBinding {
    pub version: Option<TextureVersion>,
    pub parameters: TextureParameters,
}
pub enum ResourceOperation {
    DefineTexture {
        version: TextureVersion,
        width: u32,
        height: u32,
        data: Vec<u8>,
    },
    UpdateTexture {
        version: TextureVersion,
        previous: TextureVersion,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
        data: Vec<u8>,
    },
    WriteTexture {
        version: TextureVersion,
        previous: TextureVersion,
    },
    RetireTexture {
        version: TextureVersion,
    },
    RetireDepth {
        renderbuffer: ObjectHandle,
        storage_generation: u64,
    },
}
#[derive(Clone, Copy)]
pub(super) struct TextureStorage {
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) format: u32,
}
pub(super) struct Texture {
    pub(super) deleted: bool,
    pub(super) references: usize,
    pub(super) bound: bool,
    pub(super) storage: Option<TextureStorage>,
    pub(super) storage_generation: u64,
    pub(super) content_version: u64,
    parameters: TextureParameters,
}
pub(super) struct TextureState {
    pub(super) slots: Vec<RenderSlot<Texture>>,
    pub(super) units: [Option<ObjectHandle>; 32],
    pub(super) active: usize,
    unpack_alignment: usize,
    pub(super) pack_alignment: usize,
    unpack_flip: bool,
    unpack_premultiply: bool,
    unpack_colorspace: u32,
    pub(super) before: Vec<ResourceOperation>,
    pub(super) after: Vec<ResourceOperation>,
}
impl Default for TextureState {
    fn default() -> Self {
        Self {
            slots: Vec::new(),
            units: [None; 32],
            active: 0,
            unpack_alignment: 4,
            pack_alignment: 4,
            unpack_flip: false,
            unpack_premultiply: false,
            unpack_colorspace: 0x9244,
            before: Vec::new(),
            after: Vec::new(),
        }
    }
}

impl ContextCore {
    pub fn rollback_resource_writes(&mut self, operations: &[ResourceOperation]) {
        for operation in operations.iter().rev() {
            if let ResourceOperation::WriteTexture { version, previous } = operation {
                if let Some(index) = slot_index(
                    &self.render.textures.slots,
                    version.texture,
                    ObjectKind::Texture,
                    self.context_id,
                ) {
                    if self.texture_version(index) == *version {
                        self.render.textures.slots[index]
                            .value
                            .as_mut()
                            .unwrap()
                            .content_version = previous.content_version;
                    }
                }
            }
        }
    }
    pub fn take_resource_operations(&mut self) -> (Vec<ResourceOperation>, Vec<ResourceOperation>) {
        (
            std::mem::take(&mut self.render.textures.before),
            std::mem::take(&mut self.render.textures.after),
        )
    }
    pub(super) fn texture_index(
        &mut self,
        handle: ObjectHandle,
        allow_deleted: bool,
    ) -> Option<usize> {
        let index = slot_index(
            &self.render.textures.slots,
            handle,
            ObjectKind::Texture,
            self.context_id,
        );
        let index = index.filter(|index| {
            allow_deleted
                || !self.render.textures.slots[*index]
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
    fn bound_texture(&mut self, target: u32) -> Option<usize> {
        if target != TEXTURE_2D {
            self.record_error(INVALID_ENUM);
            return None;
        }
        let Some(handle) = self.render.textures.units[self.render.textures.active] else {
            self.record_error(INVALID_OPERATION);
            return None;
        };
        self.texture_index(handle, false)
    }
    pub(super) fn texture_version(&self, index: usize) -> TextureVersion {
        let slot = &self.render.textures.slots[index];
        let texture = slot.value.as_ref().unwrap();
        TextureVersion {
            texture: ObjectHandle {
                kind: ObjectKind::Texture,
                context_id: self.context_id,
                slot: index as u32 + 1,
                generation: slot.generation,
            },
            storage_generation: texture.storage_generation,
            content_version: texture.content_version,
        }
    }
    fn reserve_texture_operation(&mut self) -> bool {
        if self.render.textures.before.try_reserve(1).is_err() {
            self.record_error(OUT_OF_MEMORY);
            false
        } else {
            true
        }
    }
    pub(super) fn release_texture(&mut self, index: usize) {
        let Some(texture) = self.render.textures.slots[index].value.as_ref() else {
            return;
        };
        if !texture.deleted || texture.references != 0 {
            return;
        }
        if texture.storage.is_some() {
            let version = self.texture_version(index);
            if !self.reserve_texture_operation() {
                return;
            }
            self.render
                .textures
                .before
                .push(ResourceOperation::RetireTexture { version });
        }
        self.render.textures.slots[index].value = None;
    }
    pub(super) fn texture_query(&self, parameter: u32) -> Option<Reply> {
        let state = &self.render.textures;
        Some(match parameter {
            0x84e0 => Reply::Number((TEXTURE0 + state.active as u32) as f64),
            TEXTURE_2D => return None,
            0x8069 => state.units[state.active].map_or(Reply::Null, Reply::Handle),
            0x0cf5 => Reply::Number(state.unpack_alignment as f64),
            0x0d05 => Reply::Number(state.pack_alignment as f64),
            0x9240 => Reply::Boolean(state.unpack_flip),
            0x9241 => Reply::Boolean(state.unpack_premultiply),
            0x9243 => Reply::Number(state.unpack_colorspace as f64),
            _ => return None,
        })
    }
    pub(super) fn texture_invoke(&mut self, operation: &str, args: &[Argument]) -> Option<Reply> {
        let arg = |index: usize| args.get(index).unwrap_or(&Argument::Null);
        match operation {
            "createTexture" => {
                let texture = Texture {
                    deleted: false,
                    references: 0,
                    bound: false,
                    storage: None,
                    storage_generation: 0,
                    content_version: 0,
                    parameters: TextureParameters::default(),
                };
                let result = insert(
                    &mut self.render.textures.slots,
                    texture,
                    ObjectKind::Texture,
                    self.context_id,
                );
                return Some(match result {
                    Some(handle) => Reply::Handle(handle),
                    None => {
                        self.record_error(OUT_OF_MEMORY);
                        Reply::Null
                    }
                });
            }
            "isTexture" => {
                return Some(Reply::Boolean(
                    arg(0)
                        .handle()
                        .and_then(|handle| {
                            slot_index(
                                &self.render.textures.slots,
                                handle,
                                ObjectKind::Texture,
                                self.context_id,
                            )
                        })
                        .is_some_and(|index| {
                            let texture = self.render.textures.slots[index].value.as_ref().unwrap();
                            texture.bound && !texture.deleted
                        }),
                ))
            }
            "activeTexture" => {
                let unit = arg(0).number() as u32;
                if unit < TEXTURE0
                    || unit - TEXTURE0 >= self.render.texture_unit_limit.min(32) as u32
                {
                    self.record_error(INVALID_ENUM);
                } else {
                    self.render.textures.active = (unit - TEXTURE0) as usize;
                }
            }
            "bindTexture" => {
                let index = if let Some(handle) = arg(1).handle() {
                    match self.texture_index(handle, false) {
                        Some(index) => Some(index),
                        None => return Some(Reply::Null),
                    }
                } else {
                    None
                };
                if arg(0).number() as u32 != TEXTURE_2D {
                    self.record_error(INVALID_ENUM);
                    return Some(Reply::Null);
                }
                if let Some(index) = index {
                    self.render.textures.slots[index]
                        .value
                        .as_mut()
                        .unwrap()
                        .bound = true;
                }
                self.render.textures.units[self.render.textures.active] = arg(1).handle();
            }
            "deleteTexture" => {
                let Some(handle) = arg(0).handle() else {
                    return Some(Reply::Null);
                };
                let index = slot_index(
                    &self.render.textures.slots,
                    handle,
                    ObjectKind::Texture,
                    self.context_id,
                );
                let Some(index) = index else {
                    if handle.kind != ObjectKind::Texture
                        || handle.context_id != self.context_id
                        || handle.slot == 0
                        || handle.generation == 0
                        || self
                            .render
                            .textures
                            .slots
                            .get(handle.slot as usize - 1)
                            .is_none_or(|slot| handle.generation > slot.generation)
                    {
                        self.record_error(INVALID_OPERATION);
                    }
                    return Some(Reply::Null);
                };
                if self.render.textures.slots[index]
                    .value
                    .as_ref()
                    .unwrap()
                    .deleted
                {
                    return Some(Reply::Null);
                }
                if self.render.textures.slots[index]
                    .value
                    .as_ref()
                    .unwrap()
                    .storage
                    .is_some()
                    && !self.reserve_texture_operation()
                {
                    return Some(Reply::Null);
                }
                self.render.textures.slots[index]
                    .value
                    .as_mut()
                    .unwrap()
                    .deleted = true;
                for unit in &mut self.render.textures.units {
                    if *unit == Some(handle) {
                        *unit = None;
                    }
                }
                self.detach_bound_texture(handle);
                self.release_texture(index);
            }
            "texParameteri" | "texParameterf" | "getTexParameter" => {
                let Some(index) = self.bound_texture(arg(0).number() as u32) else {
                    return Some(Reply::Null);
                };
                let texture = self.render.textures.slots[index].value.as_mut().unwrap();
                let parameter = arg(1).number() as u32;
                let field = match parameter {
                    0x2800 => &mut texture.parameters.mag_filter,
                    0x2801 => &mut texture.parameters.min_filter,
                    0x2802 => &mut texture.parameters.wrap_s,
                    0x2803 => &mut texture.parameters.wrap_t,
                    _ => {
                        self.record_error(INVALID_ENUM);
                        return Some(Reply::Null);
                    }
                };
                if operation == "getTexParameter" {
                    return Some(Reply::Number(*field as f64));
                }
                let value = arg(2).number();
                let valid = match parameter {
                    0x2800 => matches!(value as u32, 0x2600 | 0x2601),
                    0x2801 => matches!(value as u32, 0x2600 | 0x2601 | 0x2700..=0x2703),
                    _ => matches!(value as u32, 0x2901 | 0x812f | 0x8370),
                };
                if value.fract() != 0.0 || !valid {
                    self.record_error(INVALID_ENUM);
                } else {
                    *field = value as u32;
                }
            }
            "pixelStorei" => {
                let parameter = arg(0).number() as u32;
                let value = arg(1).number() as i32;
                match parameter {
                    0x0cf5 | 0x0d05 => {
                        if !matches!(value, 1 | 2 | 4 | 8) {
                            self.record_error(INVALID_VALUE);
                        } else if parameter == 0x0cf5 {
                            self.render.textures.unpack_alignment = value as usize;
                        } else {
                            self.render.textures.pack_alignment = value as usize;
                        }
                    }
                    0x9240 => self.render.textures.unpack_flip = value != 0,
                    0x9241 => self.render.textures.unpack_premultiply = value != 0,
                    0x9243 => {
                        if !matches!(value, 0 | 0x9244) {
                            self.record_error(INVALID_VALUE);
                        } else {
                            self.render.textures.unpack_colorspace = value as u32;
                        }
                    }
                    _ => self.record_error(INVALID_ENUM),
                }
            }
            "texImage2D" => return Some(self.define_texture(args)),
            "texSubImage2D" => return Some(self.update_texture(args)),
            "prepareDomTextureUpload" => return Some(self.prepare_dom_texture_upload(args)),
            _ => return None,
        }
        Some(Reply::Null)
    }
    fn validate_texture_format(&mut self, format: u32, ty: u32) -> bool {
        if !matches!(format, RGBA | RGB | ALPHA | LUMINANCE | LUMINANCE_ALPHA)
            || !matches!(ty, 0x1401 | 0x8033 | 0x8034 | 0x8363)
        {
            self.record_error(INVALID_ENUM);
            return false;
        }
        if ty == 0x8363 && format != RGB || matches!(ty, 0x8033 | 0x8034) && format != RGBA {
            self.record_error(INVALID_OPERATION);
            return false;
        }
        true
    }
    fn image_dimensions(&mut self, level: f64, width: f64, height: f64, border: f64) -> bool {
        if level < 0.0
            || width < 0.0
            || height < 0.0
            || width > self.render.texture_dimension_limit as f64
            || height > self.render.texture_dimension_limit as f64
            || border != 0.0
        {
            self.record_error(INVALID_VALUE);
            return false;
        }
        true
    }
    fn validate_dom_source(&mut self, width: f64, height: f64, valid: bool) -> bool {
        if !valid
            || !width.is_finite()
            || !height.is_finite()
            || width <= 0.0
            || height <= 0.0
            || width.fract() != 0.0
            || height.fract() != 0.0
            || width > MAX_SAFE_VERSION as f64
            || height > MAX_SAFE_VERSION as f64
        {
            self.record_error(INVALID_VALUE);
            return false;
        }
        true
    }
    fn validate_texture_definition(
        &mut self,
        args: &[Argument],
    ) -> Result<usize, TextureUploadError> {
        let number = |index: usize| args[index].number();
        let Some(index) = self.bound_texture(number(0) as u32) else {
            return Err(TextureUploadError::Invalid);
        };
        let level = number(1);
        let format = number(6) as u32;
        let ty = number(7) as u32;
        if !self.image_dimensions(level, number(3), number(4), number(5))
            || !self.validate_texture_format(format, ty)
        {
            return Err(TextureUploadError::Invalid);
        }
        if number(2) as u32 != format {
            self.record_error(INVALID_OPERATION);
            return Err(TextureUploadError::Invalid);
        }
        if level != 0.0 {
            return Err(TextureUploadError::Unsupported("texture mip levels"));
        }
        if ty != 0x1401 {
            return Err(TextureUploadError::Unsupported("packed texture formats"));
        }
        let texture = self.render.textures.slots[index].value.as_ref().unwrap();
        if texture.storage_generation == MAX_SAFE_VERSION
            || texture.content_version == MAX_SAFE_VERSION
        {
            self.record_error(OUT_OF_MEMORY);
            return Err(TextureUploadError::Invalid);
        }
        Ok(index)
    }
    fn validate_texture_update(&mut self, args: &[Argument]) -> Result<usize, TextureUploadError> {
        let number = |index: usize| args[index].number();
        let Some(index) = self.bound_texture(number(0) as u32) else {
            return Err(TextureUploadError::Invalid);
        };
        let Some(storage) = self.render.textures.slots[index]
            .value
            .as_ref()
            .unwrap()
            .storage
        else {
            self.record_error(INVALID_OPERATION);
            return Err(TextureUploadError::Invalid);
        };
        let level = number(1);
        let x = number(2);
        let y = number(3);
        let width = number(4);
        let height = number(5);
        let format = number(6) as u32;
        let ty = number(7) as u32;
        if !self.image_dimensions(level, width, height, 0.0)
            || x < 0.0
            || y < 0.0
            || x + width > storage.width as f64
            || y + height > storage.height as f64
        {
            self.record_error(INVALID_VALUE);
            return Err(TextureUploadError::Invalid);
        }
        if !self.validate_texture_format(format, ty) {
            return Err(TextureUploadError::Invalid);
        }
        if format != storage.format || ty != 0x1401 {
            self.record_error(INVALID_OPERATION);
            return Err(TextureUploadError::Invalid);
        }
        if level != 0.0 {
            return Err(TextureUploadError::Unsupported("texture mip levels"));
        }
        if self.render.textures.slots[index]
            .value
            .as_ref()
            .unwrap()
            .content_version
            == MAX_SAFE_VERSION
        {
            self.record_error(OUT_OF_MEMORY);
            return Err(TextureUploadError::Invalid);
        }
        Ok(index)
    }
    fn prepare_dom_texture_upload(&mut self, args: &[Argument]) -> Reply {
        if !(11..=12).contains(&args.len()) || !matches!(args[0], Argument::Boolean(_)) {
            self.record_error(INVALID_VALUE);
            return Reply::Null;
        }
        if !self.validate_dom_source(args[6].number(), args[7].number(), args[10].boolean()) {
            return Reply::Null;
        }
        if args.get(11).is_some_and(Argument::boolean) {
            self.record_error(INVALID_OPERATION);
            return Reply::Null;
        }
        let number = |index: usize| Argument::Number(args[index].number());
        let sub_image = args[0].boolean();
        let parameters = if sub_image {
            [
                number(1),
                number(2),
                number(4),
                number(5),
                number(6),
                number(7),
                number(8),
                number(9),
                Argument::Null,
            ]
        } else {
            [
                number(1),
                number(2),
                number(3),
                number(6),
                number(7),
                Argument::Number(0.0),
                number(8),
                number(9),
                Argument::Null,
            ]
        };
        let validated = if sub_image {
            self.validate_texture_update(&parameters)
        } else {
            self.validate_texture_definition(&parameters)
        };
        if let Err(error) = validated {
            return error.reply();
        }
        let state = &self.render.textures;
        Reply::Ints(vec![
            i32::from(state.unpack_flip),
            i32::from(state.unpack_premultiply),
            state.unpack_colorspace as i32,
        ])
    }
    fn unpack_pixels(
        &mut self,
        width: u32,
        height: u32,
        format: u32,
        source: &Argument,
        allow_null: bool,
    ) -> Option<Vec<u8>> {
        let dom = matches!(source, Argument::DomPixels { .. });
        let converted = matches!(
            source,
            Argument::DomPixels {
                converted: true,
                ..
            }
        );
        let channels = if dom {
            4
        } else {
            match format {
                RGBA => 4,
                RGB => 3,
                LUMINANCE_ALPHA => 2,
                _ => 1,
            }
        };
        let alignment = if dom {
            1
        } else {
            self.render.textures.unpack_alignment
        };
        let layout = (|| {
            let row = (width as usize).checked_mul(channels)?;
            let stride = row
                .checked_add(alignment - 1)?
                .checked_div(alignment)?
                .checked_mul(alignment)?;
            let required = if width == 0 || height == 0 {
                0
            } else {
                (height as usize - 1)
                    .checked_mul(stride)?
                    .checked_add(row)?
            };
            Some((stride, required))
        })();
        let Some((stride, required)) = layout else {
            self.record_error(OUT_OF_MEMORY);
            return None;
        };
        let source = match source {
            Argument::Null if allow_null => None,
            Argument::Null => {
                self.record_error(INVALID_VALUE);
                return None;
            }
            Argument::Pixels { data, valid_u8 } | Argument::DomPixels { data, valid_u8, .. } => {
                if !valid_u8 || data.len() < required {
                    self.record_error(INVALID_OPERATION);
                    return None;
                }
                Some(data.as_slice())
            }
            _ => {
                self.record_error(INVALID_OPERATION);
                return None;
            }
        };
        let Some(length) = (width as usize)
            .checked_mul(height as usize)
            .and_then(|pixels| pixels.checked_mul(4))
        else {
            self.record_error(OUT_OF_MEMORY);
            return None;
        };
        let Some(mut pixels) = zeroed(length) else {
            self.record_error(OUT_OF_MEMORY);
            return None;
        };
        for y in 0..height as usize {
            for x in 0..width as usize {
                let source_y = if self.render.textures.unpack_flip && !converted {
                    height as usize - 1 - y
                } else {
                    y
                };
                let offset = source_y * stride + x * channels;
                let (mut r, mut g, mut b, a) = if let Some(bytes) = source {
                    let first = bytes[offset];
                    match if dom { RGBA } else { format } {
                        RGBA => (
                            first,
                            bytes[offset + 1],
                            bytes[offset + 2],
                            bytes[offset + 3],
                        ),
                        RGB => (first, bytes[offset + 1], bytes[offset + 2], 255),
                        ALPHA => (0, 0, 0, first),
                        LUMINANCE => (first, first, first, 255),
                        _ => (first, first, first, bytes[offset + 1]),
                    }
                } else {
                    (
                        0,
                        0,
                        0,
                        if matches!(format, RGB | LUMINANCE) {
                            255
                        } else {
                            0
                        },
                    )
                };
                if self.render.textures.unpack_premultiply && !converted {
                    let multiply = |channel: u8| ((channel as u32 * a as u32 + 127) / 255) as u8;
                    r = multiply(r);
                    g = multiply(g);
                    b = multiply(b);
                }
                let a = if dom {
                    match format {
                        RGB => 255,
                        ALPHA => {
                            r = 0;
                            g = 0;
                            b = 0;
                            a
                        }
                        LUMINANCE => {
                            g = r;
                            b = r;
                            255
                        }
                        LUMINANCE_ALPHA => {
                            g = r;
                            b = r;
                            a
                        }
                        _ => a,
                    }
                } else {
                    a
                };
                let destination = (y * width as usize + x) * 4;
                pixels[destination..destination + 4].copy_from_slice(&[r, g, b, a]);
            }
        }
        Some(pixels)
    }
    fn define_texture(&mut self, args: &[Argument]) -> Reply {
        if args.len() != 9 {
            return Reply::Unsupported("DOM texture sources");
        }
        if matches!(args[8], Argument::DomPixels { .. })
            && !self.validate_dom_source(args[3].number(), args[4].number(), true)
        {
            return Reply::Null;
        }
        let index = match self.validate_texture_definition(args) {
            Ok(index) => index,
            Err(error) => return error.reply(),
        };
        let number = |index: usize| args[index].number();
        let width = number(3);
        let height = number(4);
        let format = number(6) as u32;
        let Some(data) = self.unpack_pixels(width as u32, height as u32, format, &args[8], true)
        else {
            return Reply::Null;
        };
        if !self.reserve_texture_operation() {
            return Reply::Null;
        }
        let texture = self.render.textures.slots[index].value.as_mut().unwrap();
        texture.storage_generation += 1;
        texture.content_version += 1;
        texture.storage = Some(TextureStorage {
            width: width as u32,
            height: height as u32,
            format,
        });
        let version = self.texture_version(index);
        self.render
            .textures
            .before
            .push(ResourceOperation::DefineTexture {
                version,
                width: width as u32,
                height: height as u32,
                data,
            });
        Reply::Null
    }
    fn update_texture(&mut self, args: &[Argument]) -> Reply {
        if args.len() != 9 {
            return Reply::Unsupported("DOM texture sources");
        }
        if matches!(args[8], Argument::DomPixels { .. })
            && !self.validate_dom_source(args[4].number(), args[5].number(), true)
        {
            return Reply::Null;
        }
        let index = match self.validate_texture_update(args) {
            Ok(index) => index,
            Err(error) => return error.reply(),
        };
        let number = |index: usize| args[index].number();
        let x = number(2);
        let y = number(3);
        let width = number(4);
        let height = number(5);
        let format = number(6) as u32;
        let Some(data) = self.unpack_pixels(width as u32, height as u32, format, &args[8], false)
        else {
            return Reply::Null;
        };
        if width == 0.0 || height == 0.0 {
            return Reply::Null;
        }
        if !self.reserve_texture_operation() {
            return Reply::Null;
        }
        let previous = self.texture_version(index);
        self.render.textures.slots[index]
            .value
            .as_mut()
            .unwrap()
            .content_version += 1;
        let version = self.texture_version(index);
        self.render
            .textures
            .before
            .push(ResourceOperation::UpdateTexture {
                version,
                previous,
                x: x as u32,
                y: y as u32,
                width: width as u32,
                height: height as u32,
                data,
            });
        Reply::Null
    }
    pub(super) fn sampled_textures(&self, executable: &Executable) -> Option<Vec<TextureBinding>> {
        let mut bindings = Vec::new();
        bindings
            .try_reserve_exact(executable.layout.samplers.len())
            .ok()?;
        for index in 0..executable.layout.samplers.len() {
            let unit = executable.values[executable.layout.uniforms.len() + index][0] as usize;
            let texture = self
                .render
                .textures
                .units
                .get(unit)
                .copied()
                .flatten()
                .and_then(|handle| {
                    slot_index(
                        &self.render.textures.slots,
                        handle,
                        ObjectKind::Texture,
                        self.context_id,
                    )
                });
            if let Some(index) = texture {
                let texture = self.render.textures.slots[index].value.as_ref().unwrap();
                bindings.push(TextureBinding {
                    version: if texture_complete(texture) {
                        Some(self.texture_version(index))
                    } else {
                        None
                    },
                    parameters: texture.parameters,
                });
            } else {
                bindings.push(TextureBinding {
                    version: None,
                    parameters: TextureParameters {
                        min_filter: 0x2600,
                        mag_filter: 0x2600,
                        wrap_s: 0x812f,
                        wrap_t: 0x812f,
                    },
                });
            }
        }
        Some(bindings)
    }
}

pub(super) fn texture_complete(texture: &Texture) -> bool {
    let Some(storage) = texture.storage else {
        return false;
    };
    if storage.width == 0 || storage.height == 0 {
        return false;
    }
    let parameters = texture.parameters;
    let non_mip = matches!(parameters.min_filter, 0x2600 | 0x2601);
    if !non_mip && (storage.width != 1 || storage.height != 1) {
        return false;
    }
    if !storage.width.is_power_of_two() || !storage.height.is_power_of_two() {
        return non_mip && parameters.wrap_s == 0x812f && parameters.wrap_t == 0x812f;
    }
    true
}

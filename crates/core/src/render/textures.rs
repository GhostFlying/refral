use super::*;

const TEXTURE_2D: u32 = 0x0de1;
pub(super) const TEXTURE_CUBE_MAP: u32 = 0x8513;
const CUBE_POSITIVE_X: u32 = 0x8515;
const CUBE_NEGATIVE_Z: u32 = 0x851a;
const TEXTURE0: u32 = 0x84c0;
const RGBA: u32 = 0x1908;
const RGB: u32 = 0x1907;
const ALPHA: u32 = 0x1906;
const LUMINANCE: u32 = 0x1909;
const LUMINANCE_ALPHA: u32 = 0x190a;
const UNSIGNED_BYTE: u32 = 0x1401;
const UNSIGNED_SHORT_4_4_4_4: u32 = 0x8033;
const UNSIGNED_SHORT_5_5_5_1: u32 = 0x8034;
const UNSIGNED_SHORT_5_6_5: u32 = 0x8363;

fn expand_component(value: u16, mask: u16) -> u8 {
    ((value * 255 + mask / 2) / mask) as u8
}

fn quantize_channel(value: u8, bits: u32) -> u8 {
    expand_component(u16::from(value >> (8 - bits)), (1 << bits) - 1)
}

fn float_texel(
    format: u32,
    dom: bool,
    source: Option<&[u8]>,
    offset: usize,
    premultiply: bool,
) -> [f32; 4] {
    let read = |i: usize| match source {
        None => 0.0,
        Some(bytes) if dom => f32::from(bytes[offset + i]) / 255.0,
        Some(bytes) => {
            let start = offset + i * 4;
            f32::from_le_bytes(bytes[start..start + 4].try_into().unwrap())
        }
    };
    let [r, g, b, a] = match format {
        ALPHA => [0.0, 0.0, 0.0, read(if dom { 3 } else { 0 })],
        LUMINANCE => [read(0), read(0), read(0), 1.0],
        LUMINANCE_ALPHA => [read(0), read(0), read(0), read(if dom { 3 } else { 1 })],
        RGB => [read(0), read(1), read(2), 1.0],
        _ => [read(0), read(1), read(2), read(3)],
    };
    let alpha = if !premultiply {
        1.0
    } else if dom {
        read(3)
    } else {
        a
    };
    [r * alpha, g * alpha, b * alpha, a]
}

fn unpack_word(word: u16, ty: u32) -> (u8, u8, u8, u8) {
    match ty {
        UNSIGNED_SHORT_5_6_5 => (
            expand_component(word >> 11, 31),
            expand_component((word >> 5) & 63, 63),
            expand_component(word & 31, 31),
            255,
        ),
        UNSIGNED_SHORT_4_4_4_4 => (
            expand_component(word >> 12, 15),
            expand_component((word >> 8) & 15, 15),
            expand_component((word >> 4) & 15, 15),
            expand_component(word & 15, 15),
        ),
        UNSIGNED_SHORT_5_5_5_1 => (
            expand_component(word >> 11, 31),
            expand_component((word >> 6) & 31, 31),
            expand_component((word >> 1) & 31, 31),
            ((word & 1) * 255) as u8,
        ),
        _ => unreachable!("non-packed pixel type passed to unpack_word"),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TextureVersion {
    pub texture: ObjectHandle,
    pub storage_generation: u64,
    pub content_version: u64,
    pub image_target: u32,
    pub level: u32,
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
    pub images: TextureImages,
    pub parameters: TextureParameters,
}
#[derive(Debug, PartialEq, Eq)]
pub enum TextureImages {
    Texture2D(Option<TextureVersion>),
    Cube(Option<[TextureVersion; 6]>),
    MipChain {
        cube: bool,
        levels: usize,
        images: Vec<TextureVersion>,
    },
}

impl TextureImages {
    /// Every image of a complete binding belongs to the same logical texture.
    pub(super) fn texture(&self) -> Option<ObjectHandle> {
        match self {
            Self::Texture2D(image) => image.as_ref(),
            Self::Cube(images) => images.as_ref().map(|faces| &faces[0]),
            Self::MipChain { images, .. } => images.first(),
        }
        .map(|image| image.texture)
    }
}

pub struct TextureCopy {
    pub source: TargetSnapshot,
    pub source_x: i32,
    pub source_y: i32,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub format: u32,
    pub ty: u32,
}

pub enum TexelFormat {
    Unorm8,
    Float32,
    Srgb8,
}

pub enum ResourceOperation {
    DefineTexture {
        texel_format: TexelFormat,
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
    GenerateTextureMip {
        version: TextureVersion,
        source: TextureVersion,
        width: u32,
        height: u32,
    },
    CopyTexture {
        version: TextureVersion,
        previous: Option<TextureVersion>,
        width: u32,
        height: u32,
        copy: TextureCopy,
    },
    WriteTexture {
        version: TextureVersion,
        previous: TextureVersion,
    },
    RetireTexture {
        version: TextureVersion,
    },
    RetireRenderbuffer {
        renderbuffer: ObjectHandle,
        storage_generation: u64,
    },
}
#[derive(Clone, Copy)]
pub(super) struct TextureStorage {
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) format: u32,
    pub(super) ty: u32,
}
#[derive(Clone, Copy, Default)]
pub(super) struct TextureImage {
    pub(super) storage: Option<TextureStorage>,
    pub(super) storage_generation: u64,
    pub(super) content_version: u64,
}
pub(super) struct Texture {
    pub(super) deleted: bool,
    pub(super) references: usize,
    pub(super) target: u32,
    // The first image is 2D. The following six are +X,-X,+Y,-Y,+Z,-Z.
    pub(super) images: [TextureImage; 7],
    mips: Vec<[TextureImage; 7]>,
    parameters: TextureParameters,
}
impl Texture {
    fn image(&self, face: usize, level: usize) -> Option<&TextureImage> {
        if level == 0 {
            self.images.get(face)
        } else {
            self.mips.get(level - 1)?.get(face)
        }
    }

    fn image_mut(&mut self, face: usize, level: usize) -> &mut TextureImage {
        if level == 0 {
            &mut self.images[face]
        } else {
            &mut self.mips[level - 1][face]
        }
    }

    fn ensure_level(&mut self, level: usize) -> bool {
        if level > self.mips.len() {
            if self.mips.try_reserve(level - self.mips.len()).is_err() {
                return false;
            }
            self.mips.resize(level, [TextureImage::default(); 7]);
        }
        true
    }

    fn levels(&self) -> impl Iterator<Item = &[TextureImage; 7]> {
        std::iter::once(&self.images).chain(&self.mips)
    }

    pub(super) fn defined_image_count(&self) -> usize {
        self.levels()
            .flatten()
            .filter(|image| image.storage.is_some())
            .count()
    }
}
pub(super) struct TextureState {
    pub(super) slots: Vec<RenderSlot<Texture>>,
    pub(super) units: [TextureUnit; 32],
    pub(super) active: usize,
    float_enabled: bool,
    pub(super) srgb_enabled: bool,
    unpack_alignment: usize,
    pub(super) pack_alignment: usize,
    unpack_flip: bool,
    unpack_premultiply: bool,
    unpack_colorspace: u32,
    pub(super) before: Vec<ResourceOperation>,
    pub(super) after: Vec<ResourceOperation>,
}
#[derive(Clone, Copy, Default)]
pub(super) struct TextureUnit {
    pub(super) texture_2d: Option<ObjectHandle>,
    pub(super) texture_cube: Option<ObjectHandle>,
}

pub(super) fn image_index(target: u32) -> Option<usize> {
    match target {
        TEXTURE_2D => Some(0),
        CUBE_POSITIVE_X..=CUBE_NEGATIVE_Z => Some((target - CUBE_POSITIVE_X + 1) as usize),
        _ => None,
    }
}

pub(super) fn image_target(index: usize) -> u32 {
    if index == 0 {
        TEXTURE_2D
    } else {
        CUBE_POSITIVE_X + index as u32 - 1
    }
}

impl TextureUnit {
    pub(super) fn binding(&self, target: u32) -> Option<ObjectHandle> {
        if target == TEXTURE_CUBE_MAP {
            self.texture_cube
        } else {
            self.texture_2d
        }
    }
}
impl Default for TextureState {
    fn default() -> Self {
        Self {
            slots: Vec::new(),
            units: [TextureUnit::default(); 32],
            active: 0,
            float_enabled: false,
            srgb_enabled: false,
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
                    let image = image_index(version.image_target).unwrap();
                    if self.texture_image_version(index, image, version.level as usize) == *version
                    {
                        self.render.textures.slots[index]
                            .value
                            .as_mut()
                            .unwrap()
                            .image_mut(image, version.level as usize)
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
        if !matches!(target, TEXTURE_2D | TEXTURE_CUBE_MAP) {
            self.record_error(INVALID_ENUM);
            return None;
        }
        let Some(handle) = self.render.textures.units[self.render.textures.active].binding(target)
        else {
            self.record_error(INVALID_OPERATION);
            return None;
        };
        self.texture_index(handle, false)
    }
    fn bound_texture_image(&mut self, target: u32) -> Option<(usize, usize)> {
        let Some(image) = image_index(target) else {
            self.record_error(INVALID_ENUM);
            return None;
        };
        let binding_target = if image == 0 {
            TEXTURE_2D
        } else {
            TEXTURE_CUBE_MAP
        };
        self.bound_texture(binding_target)
            .map(|index| (index, image))
    }
    pub(super) fn texture_version(&self, index: usize) -> TextureVersion {
        self.texture_image_version(index, 0, 0)
    }
    pub(super) fn texture_image_version(
        &self,
        index: usize,
        image: usize,
        level: usize,
    ) -> TextureVersion {
        let slot = &self.render.textures.slots[index];
        let storage = slot.value.as_ref().unwrap().image(image, level).unwrap();
        TextureVersion {
            texture: ObjectHandle {
                kind: ObjectKind::Texture,
                context_id: self.context_id,
                slot: index as u32 + 1,
                generation: slot.generation,
            },
            storage_generation: storage.storage_generation,
            content_version: storage.content_version,
            image_target: image_target(image),
            level: level as u32,
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
        let count = texture.defined_image_count();
        if self.render.textures.before.try_reserve(count).is_err() {
            self.record_error(OUT_OF_MEMORY);
            return;
        }
        for (level, images) in texture.levels().enumerate() {
            for (face, image) in images.iter().enumerate() {
                if image.storage.is_some() {
                    let version = self.texture_image_version(index, face, level);
                    self.render
                        .textures
                        .before
                        .push(ResourceOperation::RetireTexture { version });
                }
            }
        }
        self.render.textures.slots[index].value = None;
    }
    pub(super) fn texture_query(&self, parameter: u32) -> Option<Reply> {
        let state = &self.render.textures;
        Some(match parameter {
            0x86a3 => Reply::Ints(Vec::new()), // COMPRESSED_TEXTURE_FORMATS, GLenum words
            0x84e0 => Reply::Number((TEXTURE0 + state.active as u32) as f64),
            TEXTURE_2D => return None,
            0x8069 => state.units[state.active]
                .texture_2d
                .map_or(Reply::Null, Reply::Handle),
            0x8514 => state.units[state.active]
                .texture_cube
                .map_or(Reply::Null, Reply::Handle),
            0x851c => Reply::Number(self.render.texture_dimension_limit as f64),
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
            "enableSrgbTextures" => {
                self.render.textures.srgb_enabled = true;
                return Some(Reply::Null);
            }
            "enableFloatTextures" => {
                self.render.textures.float_enabled = true;
                return Some(Reply::Null);
            }
            "createTexture" => {
                let texture = Texture {
                    deleted: false,
                    references: 0,
                    target: 0,
                    images: [TextureImage::default(); 7],
                    mips: Vec::new(),
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
                            texture.target != 0 && !texture.deleted
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
                let target = arg(0).number() as u32;
                if !matches!(target, TEXTURE_2D | TEXTURE_CUBE_MAP) {
                    self.record_error(INVALID_ENUM);
                    return Some(Reply::Null);
                }
                if let Some(index) = index {
                    let texture = self.render.textures.slots[index].value.as_mut().unwrap();
                    if texture.target != 0 && texture.target != target {
                        self.record_error(INVALID_OPERATION);
                        return Some(Reply::Null);
                    }
                    texture.target = target;
                }
                let unit = &mut self.render.textures.units[self.render.textures.active];
                if target == TEXTURE_2D {
                    unit.texture_2d = arg(1).handle();
                } else {
                    unit.texture_cube = arg(1).handle();
                }
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
                let count = self.render.textures.slots[index]
                    .value
                    .as_ref()
                    .unwrap()
                    .defined_image_count();
                if self.render.textures.before.try_reserve(count).is_err() {
                    self.record_error(OUT_OF_MEMORY);
                    return Some(Reply::Null);
                }
                self.render.textures.slots[index]
                    .value
                    .as_mut()
                    .unwrap()
                    .deleted = true;
                for unit in &mut self.render.textures.units {
                    if unit.texture_2d == Some(handle) {
                        unit.texture_2d = None;
                    }
                    if unit.texture_cube == Some(handle) {
                        unit.texture_cube = None;
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
            "generateMipmap" => return Some(self.generate_mipmap(arg(0).number() as u32)),
            "compressedTexImage2D" | "compressedTexSubImage2D" => {
                if self.bound_texture_image(arg(0).number() as u32).is_some() {
                    self.record_error(INVALID_ENUM);
                }
            }
            "texImage2D" => return Some(self.define_texture(args)),
            "texSubImage2D" => return Some(self.update_texture(args)),
            "copyTexImage2D" | "copyTexSubImage2D" => {
                return Some(self.copy_framebuffer_texture(args, operation == "copyTexSubImage2D"));
            }
            "prepareDomTextureUpload" => return Some(self.prepare_dom_texture_upload(args)),
            _ => return None,
        }
        Some(Reply::Null)
    }
    fn validate_texture_format(&mut self, format: u32, ty: u32) -> bool {
        let supported_type = matches!(
            ty,
            UNSIGNED_BYTE | UNSIGNED_SHORT_4_4_4_4 | UNSIGNED_SHORT_5_5_5_1 | UNSIGNED_SHORT_5_6_5
        ) || ty == FLOAT && self.render.textures.float_enabled;
        let srgb = matches!(format, SRGB | SRGB_ALPHA) && self.render.textures.srgb_enabled;
        if !(matches!(format, RGBA | RGB | ALPHA | LUMINANCE | LUMINANCE_ALPHA) || srgb)
            || !supported_type
        {
            self.record_error(INVALID_ENUM);
            return false;
        }
        if srgb && ty != UNSIGNED_BYTE
            || ty == UNSIGNED_SHORT_5_6_5 && format != RGB
            || matches!(ty, UNSIGNED_SHORT_4_4_4_4 | UNSIGNED_SHORT_5_5_5_1) && format != RGBA
        {
            self.record_error(INVALID_OPERATION);
            return false;
        }
        true
    }
    fn level_limit(&self, level: f64) -> u32 {
        if !(0.0..32.0).contains(&level) || level.fract() != 0.0 {
            return 0;
        }
        self.render.texture_dimension_limit >> level as u32
    }
    fn image_dimensions(&mut self, level: f64, width: f64, height: f64, border: f64) -> bool {
        let limit = self.level_limit(level);
        if limit == 0
            || !(0.0..=limit as f64).contains(&width)
            || !(0.0..=limit as f64).contains(&height)
            || width.fract() != 0.0
            || height.fract() != 0.0
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
    fn validate_texture_definition(&mut self, args: &[Argument]) -> Option<(usize, usize)> {
        let number = |index: usize| args[index].number();
        let (index, image) = self.bound_texture_image(number(0) as u32)?;
        let level = number(1);
        let format = number(6) as u32;
        let ty = number(7) as u32;
        if !self.image_dimensions(level, number(3), number(4), number(5))
            || !self.validate_texture_format(format, ty)
        {
            return None;
        }
        if image != 0 && number(3) != number(4) {
            self.record_error(INVALID_VALUE);
            return None;
        }
        if level > 0.0
            && (!(number(3) as u32).is_power_of_two() || !(number(4) as u32).is_power_of_two())
        {
            self.record_error(INVALID_VALUE);
            return None;
        }
        if number(2) as u32 != format {
            self.record_error(INVALID_OPERATION);
            return None;
        }
        if self.render.textures.slots[index]
            .value
            .as_ref()
            .unwrap()
            .image(image, level as usize)
            .is_some_and(|image| {
                image.storage_generation == MAX_SAFE_VERSION
                    || image.content_version == MAX_SAFE_VERSION
            })
        {
            self.record_error(OUT_OF_MEMORY);
            return None;
        }
        Some((index, image))
    }
    fn validate_texture_update(
        &mut self,
        args: &[Argument],
        upload: bool,
    ) -> Option<(usize, usize)> {
        let number = |index: usize| args[index].number();
        let (index, image) = self.bound_texture_image(number(0) as u32)?;
        let level = number(1);
        if self.level_limit(level) == 0 {
            self.record_error(INVALID_VALUE);
            return None;
        }
        let Some(image_state) = self.render.textures.slots[index]
            .value
            .as_ref()
            .unwrap()
            .image(image, level as usize)
            .copied()
        else {
            self.record_error(INVALID_OPERATION);
            return None;
        };
        let Some(storage) = image_state.storage else {
            self.record_error(INVALID_OPERATION);
            return None;
        };
        let x = number(2);
        let y = number(3);
        let width = number(4);
        let height = number(5);
        if !self.image_dimensions(level, width, height, 0.0)
            || x < 0.0
            || y < 0.0
            || x + width > storage.width as f64
            || y + height > storage.height as f64
        {
            self.record_error(INVALID_VALUE);
            return None;
        }
        if upload {
            let format = number(6) as u32;
            let ty = number(7) as u32;
            if !self.validate_texture_format(format, ty) {
                return None;
            }
            if format != storage.format || ty != storage.ty {
                self.record_error(INVALID_OPERATION);
                return None;
            }
        }
        if image_state.content_version == MAX_SAFE_VERSION {
            self.record_error(OUT_OF_MEMORY);
            return None;
        }
        Some((index, image))
    }
    fn prepare_dom_texture_upload(&mut self, args: &[Argument]) -> Reply {
        if !(11..=13).contains(&args.len()) || !matches!(args[0], Argument::Boolean(_)) {
            self.record_error(INVALID_VALUE);
            return Reply::Null;
        }
        if args.get(12).is_some_and(Argument::boolean) {
            if self.bound_texture_image(args[1].number() as u32).is_some() {
                self.record_error(INVALID_OPERATION);
            }
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
            self.validate_texture_update(&parameters, true)
        } else {
            self.validate_texture_definition(&parameters)
        };
        if validated.is_none() {
            return Reply::Null;
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
        ty: u32,
        source: &Argument,
        allow_null: bool,
    ) -> Option<Vec<u8>> {
        let format = match format {
            SRGB => RGB,
            SRGB_ALPHA => RGBA,
            other => other,
        };
        let dom = matches!(source, Argument::DomPixels { .. });
        let converted = matches!(
            source,
            Argument::DomPixels {
                converted: true,
                ..
            }
        );
        let packed_view = !dom && ty != UNSIGNED_BYTE && ty != FLOAT;
        let dom_bits = if dom {
            match ty {
                UNSIGNED_SHORT_5_6_5 => Some([5, 6, 5, 1]),
                UNSIGNED_SHORT_4_4_4_4 => Some([4, 4, 4, 4]),
                UNSIGNED_SHORT_5_5_5_1 => Some([5, 5, 5, 1]),
                _ => None,
            }
        } else {
            None
        };
        let pixel_bytes = if dom {
            4
        } else if packed_view {
            2
        } else {
            let components = match format {
                RGBA => 4,
                RGB => 3,
                LUMINANCE_ALPHA => 2,
                _ => 1,
            };
            components * if ty == FLOAT { 4 } else { 1 }
        };
        let alignment = if dom {
            1
        } else {
            self.render.textures.unpack_alignment
        };
        let layout = (|| {
            let row = (width as usize).checked_mul(pixel_bytes)?;
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
            Argument::Pixels { data, view } | Argument::DomPixels { data, view, .. } => {
                let expected_view = if ty == FLOAT && !dom {
                    PixelView::F32
                } else if packed_view {
                    PixelView::U16
                } else {
                    PixelView::U8
                };
                if *view != expected_view || data.len() < required {
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
            .and_then(|pixels| pixels.checked_mul(if ty == FLOAT { 16 } else { 4 }))
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
                let offset = source_y * stride + x * pixel_bytes;
                if ty == FLOAT {
                    let texel = float_texel(
                        format,
                        dom,
                        source,
                        offset,
                        self.render.textures.unpack_premultiply && !converted,
                    );
                    let dst = (y * width as usize + x) * 16;
                    for (channel, component) in texel.iter().enumerate() {
                        pixels[dst + channel * 4..dst + channel * 4 + 4]
                            .copy_from_slice(&component.to_le_bytes());
                    }
                    continue;
                }
                let (mut r, mut g, mut b, a) = if let Some(bytes) = source {
                    if packed_view {
                        let word = u16::from_le_bytes([bytes[offset], bytes[offset + 1]]);
                        unpack_word(word, ty)
                    } else {
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
                let rgba = [r, g, b, a];
                let rgba = if let Some([red, green, blue, alpha]) = dom_bits {
                    [
                        quantize_channel(r, red),
                        quantize_channel(g, green),
                        quantize_channel(b, blue),
                        quantize_channel(a, alpha),
                    ]
                } else {
                    rgba
                };
                pixels[destination..destination + 4].copy_from_slice(&rgba);
            }
        }
        Some(pixels)
    }
    fn define_texture(&mut self, args: &[Argument]) -> Reply {
        if args.len() != 9 {
            return Reply::Unsupported("DOM texture sources");
        }
        let dom = matches!(args[8], Argument::DomPixels { .. });
        if dom && !self.validate_dom_source(args[3].number(), args[4].number(), true) {
            return Reply::Null;
        }
        let Some((index, image)) = self.validate_texture_definition(args) else {
            return Reply::Null;
        };
        let number = |index: usize| args[index].number();
        let width = number(3);
        let height = number(4);
        let format = number(6) as u32;
        let ty = number(7) as u32;
        let Some(data) =
            self.unpack_pixels(width as u32, height as u32, format, ty, &args[8], true)
        else {
            return Reply::Null;
        };
        if !self.reserve_texture_operation() {
            return Reply::Null;
        }
        let level = number(1) as usize;
        let texture = self.render.textures.slots[index].value.as_mut().unwrap();
        if !texture.ensure_level(level) {
            self.record_error(OUT_OF_MEMORY);
            return Reply::Null;
        }
        let image_state = texture.image_mut(image, level);
        image_state.storage_generation += 1;
        image_state.content_version += 1;
        image_state.storage = Some(TextureStorage {
            width: width as u32,
            height: height as u32,
            format,
            ty,
        });
        let version = self.texture_image_version(index, image, level);
        self.render
            .textures
            .before
            .push(ResourceOperation::DefineTexture {
                texel_format: if ty == FLOAT {
                    TexelFormat::Float32
                } else if matches!(format, SRGB | SRGB_ALPHA) {
                    TexelFormat::Srgb8
                } else {
                    TexelFormat::Unorm8
                },
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
        let dom = matches!(args[8], Argument::DomPixels { .. });
        if dom && !self.validate_dom_source(args[4].number(), args[5].number(), true) {
            return Reply::Null;
        }
        let Some((index, image)) = self.validate_texture_update(args, true) else {
            return Reply::Null;
        };
        let number = |index: usize| args[index].number();
        let x = number(2);
        let y = number(3);
        let width = number(4);
        let height = number(5);
        let format = number(6) as u32;
        let ty = number(7) as u32;
        let Some(data) =
            self.unpack_pixels(width as u32, height as u32, format, ty, &args[8], false)
        else {
            return Reply::Null;
        };
        if width == 0.0 || height == 0.0 {
            return Reply::Null;
        }
        if !self.reserve_texture_operation() {
            return Reply::Null;
        }
        let level = number(1) as usize;
        let previous = self.texture_image_version(index, image, level);
        self.render.textures.slots[index]
            .value
            .as_mut()
            .unwrap()
            .image_mut(image, level)
            .content_version += 1;
        let version = self.texture_image_version(index, image, level);
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
    fn copy_framebuffer_texture(&mut self, args: &[Argument], subimage: bool) -> Reply {
        if args.len() != 8 {
            self.record_error(INVALID_VALUE);
            return Reply::Null;
        }
        let number = |index: usize| args[index].number();
        let (texture_target, level) = (number(0), number(1));
        let (source_x, source_y, width, height) = if subimage {
            (number(4), number(5), number(6), number(7))
        } else {
            (number(3), number(4), number(5), number(6))
        };
        let sub_format = number(2);
        let (x, y, index, face) = if subimage {
            let (x, y) = (number(2), number(3));
            let parameters = [texture_target, level, x, y, width, height].map(Argument::Number);
            let Some((index, face)) = self.validate_texture_update(&parameters, false) else {
                return Reply::Null;
            };
            (x as u32, y as u32, index, face)
        } else {
            let parameters = [
                texture_target,
                level,
                sub_format,
                width,
                height,
                number(7),
                sub_format,
                UNSIGNED_BYTE as f64,
            ]
            .map(Argument::Number);
            let Some((index, face)) = self.validate_texture_definition(&parameters) else {
                return Reply::Null;
            };
            if matches!(sub_format as u32, SRGB | SRGB_ALPHA) {
                self.record_error(INVALID_ENUM);
                return Reply::Null;
            }
            (0, 0, index, face)
        };
        let level = level as usize;
        let (width, height) = (width as u32, height as u32);
        let old_storage = self.render.textures.slots[index]
            .value
            .as_ref()
            .unwrap()
            .image(face, level)
            .and_then(|image| image.storage);
        let storage = if subimage {
            let storage = old_storage.unwrap();
            if storage.ty == FLOAT {
                self.record_error(INVALID_OPERATION);
                return Reply::Null;
            }
            storage
        } else {
            TextureStorage {
                width,
                height,
                format: sub_format as u32,
                ty: UNSIGNED_BYTE,
            }
        };
        let Some(source) = self.target_snapshot(true) else {
            return Reply::Null;
        };
        let source_is_srgb = source
            .color_renderbuffer
            .is_some_and(|color| color.format == SRGB8_ALPHA8)
            || source.color.is_some_and(|image| {
                let state = &self.render.textures.slots[image.texture.slot as usize - 1];
                state
                    .value
                    .as_ref()
                    .and_then(|texture| {
                        texture
                            .image(image_index(image.image_target)?, image.level as usize)?
                            .storage
                    })
                    .is_some_and(|storage| storage.format == SRGB_ALPHA)
            });
        if matches!(storage.format, SRGB | SRGB_ALPHA)
            || source_is_srgb
            || (!self.source_has_alpha(&source) && !matches!(storage.format, RGB | LUMINANCE))
            || source.color.is_some_and(|image| {
                image.texture.slot as usize == index + 1
                    && image.image_target == image_target(face)
                    && image.level as usize == level
            })
        {
            self.record_error(INVALID_OPERATION);
            return Reply::Null;
        }
        if subimage
            && (width == 0
                || height == 0
                || source_x >= source.width as f64
                || source_y >= source.height as f64
                || source_x + width as f64 <= 0.0
                || source_y + height as f64 <= 0.0)
        {
            return Reply::Null;
        }
        if !self.reserve_texture_operation() {
            return Reply::Null;
        }
        let previous = subimage.then(|| self.texture_image_version(index, face, level));
        let texture = self.render.textures.slots[index].value.as_mut().unwrap();
        if !texture.ensure_level(level) {
            self.record_error(OUT_OF_MEMORY);
            return Reply::Null;
        }
        let image = texture.image_mut(face, level);
        if !subimage {
            image.storage_generation += 1;
        }
        image.content_version += 1;
        image.storage = Some(storage);
        let version = self.texture_image_version(index, face, level);
        self.render
            .textures
            .before
            .push(ResourceOperation::CopyTexture {
                version,
                previous,
                width: storage.width,
                height: storage.height,
                copy: TextureCopy {
                    source,
                    source_x: source_x as i32,
                    source_y: source_y as i32,
                    x,
                    y,
                    width,
                    height,
                    format: storage.format,
                    ty: storage.ty,
                },
            });
        Reply::Null
    }

    fn generate_mipmap(&mut self, target: u32) -> Reply {
        let Some(index) = self.bound_texture(target) else {
            return Reply::Null;
        };
        let texture = self.render.textures.slots[index].value.as_ref().unwrap();
        let Some(base) = texture.complete_base().filter(|base| {
            base.width.is_power_of_two()
                && base.height.is_power_of_two()
                && !matches!(base.format, SRGB | SRGB_ALPHA)
        }) else {
            self.record_error(INVALID_OPERATION);
            return Reply::Null;
        };
        let faces = texture.faces();
        let levels = base.width.max(base.height).ilog2() as usize;
        for level in 1..=levels {
            for face in faces.clone() {
                if texture.image(face, level).is_some_and(|image| {
                    image.storage_generation == MAX_SAFE_VERSION
                        || image.content_version == MAX_SAFE_VERSION
                }) {
                    self.record_error(OUT_OF_MEMORY);
                    return Reply::Null;
                }
            }
        }
        if self
            .render
            .textures
            .before
            .try_reserve(levels * faces.len())
            .is_err()
            || !self.render.textures.slots[index]
                .value
                .as_mut()
                .unwrap()
                .ensure_level(levels)
        {
            self.record_error(OUT_OF_MEMORY);
            return Reply::Null;
        }
        for level in 1..=levels {
            for face in faces.clone() {
                let source = self.texture_image_version(index, face, level - 1);
                let image = self.render.textures.slots[index]
                    .value
                    .as_mut()
                    .unwrap()
                    .image_mut(face, level);
                let width = (base.width >> level).max(1);
                let height = (base.height >> level).max(1);
                image.storage_generation += 1;
                image.content_version += 1;
                image.storage = Some(TextureStorage {
                    width,
                    height,
                    ..base
                });
                let version = self.texture_image_version(index, face, level);
                self.render
                    .textures
                    .before
                    .push(ResourceOperation::GenerateTextureMip {
                        version,
                        source,
                        width,
                        height,
                    });
            }
        }
        Reply::Null
    }
    pub(super) fn sampler_target(ty: u32) -> u32 {
        if ty == 0x8b60 {
            TEXTURE_CUBE_MAP
        } else {
            TEXTURE_2D
        }
    }

    pub(super) fn sampler_units_valid(&self, executable: &Executable) -> bool {
        let mut types = [0_u32; 32];
        for (ty, unit) in executable.sampled_units() {
            let Some(previous) = types.get_mut(unit) else {
                return false;
            };
            if *previous != 0 && *previous != ty {
                return false;
            }
            *previous = ty;
        }
        true
    }

    pub(super) fn sampled_textures(&self, executable: &Executable) -> Option<Vec<TextureBinding>> {
        let mut bindings = Vec::new();
        bindings
            .try_reserve_exact(
                executable
                    .layout
                    .samplers
                    .iter()
                    .map(|s| s.size as usize)
                    .sum(),
            )
            .ok()?;
        for (ty, unit) in executable.sampled_units() {
            let target = Self::sampler_target(ty);
            let texture_index = self
                .render
                .textures
                .units
                .get(unit)
                .and_then(|unit| unit.binding(target))
                .and_then(|handle| {
                    slot_index(
                        &self.render.textures.slots,
                        handle,
                        ObjectKind::Texture,
                        self.context_id,
                    )
                });
            let texture =
                texture_index.and_then(|index| self.render.textures.slots[index].value.as_ref());
            let levels = texture.map_or(0, texture_sampling_level_count);
            let cube = target == TEXTURE_CUBE_MAP;
            let images = if levels > 1 {
                let faces = if cube { 1..7 } else { 0..1 };
                let mut images = Vec::new();
                images.try_reserve_exact(levels * faces.len()).ok()?;
                for level in 0..levels {
                    for face in faces.clone() {
                        images.push(self.texture_image_version(
                            texture_index.unwrap(),
                            face,
                            level,
                        ));
                    }
                }
                TextureImages::MipChain {
                    cube,
                    levels,
                    images,
                }
            } else if cube {
                TextureImages::Cube((levels == 1).then(|| {
                    std::array::from_fn(|face| {
                        self.texture_image_version(texture_index.unwrap(), face + 1, 0)
                    })
                }))
            } else {
                TextureImages::Texture2D(
                    (levels == 1).then(|| self.texture_version(texture_index.unwrap())),
                )
            };
            bindings.push(TextureBinding {
                images,
                parameters: texture.map_or(
                    TextureParameters {
                        min_filter: 0x2600,
                        mag_filter: 0x2600,
                        wrap_s: 0x812f,
                        wrap_t: 0x812f,
                    },
                    |texture| texture.parameters,
                ),
            });
        }
        Some(bindings)
    }
}

impl Texture {
    fn faces(&self) -> std::ops::Range<usize> {
        if self.target == TEXTURE_CUBE_MAP {
            1..7
        } else {
            0..1
        }
    }

    pub(super) fn complete_base(&self) -> Option<TextureStorage> {
        let faces = self.faces();
        let base = self.images[faces.start].storage?;
        if base.width == 0
            || base.height == 0
            || (self.target == TEXTURE_CUBE_MAP && base.width != base.height)
            || faces.clone().any(|face| {
                !self.images[face].storage.is_some_and(|image| {
                    image.width == base.width
                        && image.height == base.height
                        && image.format == base.format
                        && image.ty == base.ty
                })
            })
        {
            return None;
        }
        Some(base)
    }
}

fn texture_sampling_level_count(texture: &Texture) -> usize {
    let Some(base) = texture.complete_base() else {
        return 0;
    };
    let parameters = texture.parameters;
    if base.ty == FLOAT
        && (parameters.mag_filter != 0x2600 || !matches!(parameters.min_filter, 0x2600 | 0x2700))
    {
        return 0;
    }
    let non_mip = matches!(parameters.min_filter, 0x2600 | 0x2601);
    if !base.width.is_power_of_two() || !base.height.is_power_of_two() {
        return usize::from(non_mip && parameters.wrap_s == 0x812f && parameters.wrap_t == 0x812f);
    }
    if non_mip {
        return 1;
    }
    let levels = base.width.max(base.height).ilog2() as usize + 1;
    for level in 1..levels {
        let width = (base.width >> level).max(1);
        let height = (base.height >> level).max(1);
        for face in texture.faces() {
            if !texture
                .image(face, level)
                .and_then(|image| image.storage)
                .is_some_and(|image| {
                    image.width == width
                        && image.height == height
                        && image.format == base.format
                        && image.ty == base.ty
                })
            {
                return 0;
            }
        }
    }
    levels
}

#[cfg(test)]
pub(super) fn texture_complete(texture: &Texture) -> bool {
    texture_sampling_level_count(texture) > 0
}

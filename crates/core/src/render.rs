use super::*;

#[cfg(test)]
mod cube_texture_tests;
#[cfg(test)]
mod dom_texture_tests;
mod framebuffers;
mod raster;
mod readback;
#[cfg(test)]
mod texture_tests;
mod textures;
pub use framebuffers::{ColorRenderbufferAttachment, DepthAttachment, TargetSnapshot};
mod uniforms;
pub use raster::{RasterState, StencilFace};
pub use readback::ReadPixelsPlan;
pub use textures::{
    ResourceOperation, TextureBinding, TextureCopy, TextureImages, TextureParameters,
    TextureVersion,
};

pub const VERTEX_SHADER: u32 = 0x8b31;
pub const FRAGMENT_SHADER: u32 = 0x8b30;
pub const FLOAT: u32 = 0x1406;
pub const FLOAT_VEC2: u32 = 0x8b50;
pub const FLOAT_VEC3: u32 = 0x8b51;
pub const FLOAT_VEC4: u32 = 0x8b52;
pub const TRIANGLES: u32 = 4;
pub const TRIANGLE_STRIP: u32 = 5;

fn vertex_component_bytes(ty: u32) -> Option<usize> {
    match ty {
        0x1400 | 0x1401 => Some(1),
        0x1402 | 0x1403 => Some(2),
        FLOAT => Some(4),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum ObjectKind {
    Buffer = 1,
    Shader = 2,
    Program = 3,
    UniformLocation = 4,
    Texture = 5,
    Renderbuffer = 6,
    Framebuffer = 7,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ObjectHandle {
    pub kind: ObjectKind,
    pub context_id: u32,
    pub slot: u32,
    pub generation: u32,
}

impl From<BufferHandle> for ObjectHandle {
    fn from(handle: BufferHandle) -> Self {
        Self {
            kind: ObjectKind::Buffer,
            context_id: handle.context_id,
            slot: handle.slot,
            generation: handle.generation,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PixelView {
    U8,
    U16,
    Other,
}

pub enum Argument {
    Null,
    Number(f64),
    Boolean(bool),
    Handle(ObjectHandle),
    Text(Vec<u16>),
    Floats(Vec<f32>),
    Ints(Vec<i32>),
    Pixels {
        data: Vec<u8>,
        view: PixelView,
    },
    DomPixels {
        data: Vec<u8>,
        view: PixelView,
        converted: bool,
    },
}
impl Argument {
    fn number(&self) -> f64 {
        if let Self::Number(value) = self {
            *value
        } else {
            0.0
        }
    }
    fn handle(&self) -> Option<ObjectHandle> {
        if let Self::Handle(value) = self {
            Some(*value)
        } else {
            None
        }
    }
    fn text(&self) -> &[u16] {
        if let Self::Text(value) = self {
            value
        } else {
            &[]
        }
    }
    fn floats(&self) -> &[f32] {
        if let Self::Floats(value) = self {
            value
        } else {
            &[]
        }
    }
    fn boolean(&self) -> bool {
        matches!(self, Self::Boolean(true))
    }
}

#[derive(Clone, Debug)]
pub struct ActiveInfo {
    pub name: String,
    pub size: u32,
    pub ty: u32,
}
#[derive(Clone, Debug)]
pub struct AttributeInfo {
    pub active: ActiveInfo,
    pub location: u32,
}
#[derive(Clone, Debug)]
pub struct UniformInfo {
    pub active: ActiveInfo,
    pub vertex_offset: Option<usize>,
    pub fragment_offset: Option<usize>,
    pub array_stride: usize,
    pub matrix_stride: usize,
}
#[derive(Clone, Debug, Default)]
pub struct ProgramLayout {
    pub attributes: Vec<AttributeInfo>,
    pub uniforms: Vec<UniformInfo>,
    pub samplers: Vec<ActiveInfo>,
    pub vertex_bytes: usize,
    pub fragment_bytes: usize,
}
pub struct CompileOutcome {
    pub artifact_id: u32,
    pub success: bool,
    pub log: String,
}
pub struct LinkOutcome {
    pub artifact_id: u32,
    pub success: bool,
    pub log: String,
    pub layout: ProgramLayout,
}
pub struct CompileRequest {
    pub request_id: u32,
    pub shader: ObjectHandle,
    pub stage: u32,
    pub source: Vec<u16>,
}
pub struct LinkRequest {
    pub request_id: u32,
    pub program: ObjectHandle,
    pub vertex_artifact: Option<u32>,
    pub fragment_artifact: Option<u32>,
    pub bindings: Vec<(String, u32)>,
}
pub struct AttributeDraw {
    pub location: u32,
    pub shader_type: u32,
    pub size: u32,
    pub ty: u32,
    pub normalized: bool,
    pub stride: u32,
    pub offset: usize,
    pub data: Option<BufferSnapshot>,
    pub constant: [f32; 4],
}
pub struct DrawSnapshot {
    pub artifact_id: u32,
    pub mode: u32,
    pub program: ObjectHandle,
    pub link_generation: u64,
    pub state: RasterState,
    pub target: TargetSnapshot,
    pub attributes: Vec<AttributeDraw>,
    pub vertex_count: u32,
    pub first: u32,
    pub count: u32,
    pub indices: Option<(BufferSnapshot, u32, usize)>,
    pub vertex_uniforms: Vec<u8>,
    pub fragment_uniforms: Vec<u8>,
    pub textures: Vec<TextureBinding>,
}
pub struct ClearSnapshot {
    pub state: RasterState,
    pub target: TargetSnapshot,
    pub mask: u32,
    pub color: [f32; 4],
    pub depth: f32,
}
pub enum Reply {
    Null,
    Boolean(bool),
    Number(f64),
    Handle(ObjectHandle),
    Handles(Vec<ObjectHandle>),
    Text(Vec<u16>),
    Floats(Vec<f32>),
    Ints(Vec<i32>),
    Booleans(Vec<bool>),
    Active(ActiveInfo),
    Compile(CompileRequest),
    Link(LinkRequest),
    Draw(DrawSnapshot),
    Clear(ClearSnapshot),
    Precision(bool),
    Target(TargetSnapshot),
    ReadPixelsPlan(ReadPixelsPlan),
    Unsupported(&'static str),
}

struct RenderSlot<T> {
    generation: u32,
    value: Option<T>,
}
struct Shader {
    stage: u32,
    source: Vec<u16>,
    artifact: Option<u32>,
    compiled: bool,
    log: String,
    deleted: bool,
    pending: Option<u32>,
}
struct Executable {
    id: u32,
    layout: ProgramLayout,
    values: Vec<Vec<u32>>,
    vertex: Vec<u8>,
    fragment: Vec<u8>,
}
struct Program {
    shaders: Vec<ObjectHandle>,
    bindings: Vec<(String, u32)>,
    executable: Option<Executable>,
    linked: bool,
    validated: bool,
    log: String,
    link_generation: u64,
    deleted: bool,
    pending: Option<u32>,
}
struct Location {
    program: ObjectHandle,
    link_generation: u64,
    uniform: usize,
    element: usize,
}
#[derive(Clone, Copy)]
pub(crate) struct VertexAttribute {
    pub(crate) buffer: Option<BufferHandle>,
    enabled: bool,
    size: u32,
    ty: u32,
    normalized: bool,
    stride: u32,
    offset: usize,
    constant: [f32; 4],
}
impl Default for VertexAttribute {
    fn default() -> Self {
        Self {
            buffer: None,
            enabled: false,
            size: 4,
            ty: FLOAT,
            normalized: false,
            stride: 0,
            offset: 0,
            constant: [0.0, 0.0, 0.0, 1.0],
        }
    }
}
pub(crate) struct RenderState {
    shaders: Vec<RenderSlot<Shader>>,
    programs: Vec<RenderSlot<Program>>,
    locations: Vec<RenderSlot<Location>>,
    current: Option<ObjectHandle>,
    pub(crate) attributes: [VertexAttribute; 16],
    surface: [u32; 2],
    raster: RasterState,
    dither: bool,
    texture_unit_limit: usize,
    texture_dimension_limit: u32,
    textures: textures::TextureState,
    framebuffers: framebuffers::FramebufferState,
    context_alpha: bool,
    context_depth: bool,
    context_stencil: bool,
    clear_color: [f32; 4],
    clear_depth: f32,
    next_request: u32,
    releases: Vec<u32>,
    attribute_limit: usize,
}
impl Default for RenderState {
    fn default() -> Self {
        Self {
            shaders: Vec::new(),
            programs: Vec::new(),
            locations: Vec::new(),
            current: None,
            attributes: [VertexAttribute::default(); 16],
            surface: [0, 0],
            raster: RasterState::default(),
            dither: true,
            texture_unit_limit: 8,
            texture_dimension_limit: 4096,
            textures: textures::TextureState::default(),
            framebuffers: framebuffers::FramebufferState::default(),
            context_alpha: true,
            context_depth: true,
            context_stencil: false,
            clear_color: [0.0; 4],
            clear_depth: 1.0,
            next_request: 0,
            releases: Vec::new(),
            attribute_limit: 8,
        }
    }
}

fn insert<T>(
    slots: &mut Vec<RenderSlot<T>>,
    value: T,
    kind: ObjectKind,
    context_id: u32,
) -> Option<ObjectHandle> {
    for (index, slot) in slots.iter_mut().enumerate() {
        if slot.value.is_none() && slot.generation < u32::MAX {
            slot.generation += 1;
            slot.value = Some(value);
            return Some(ObjectHandle {
                kind,
                context_id,
                slot: index as u32 + 1,
                generation: slot.generation,
            });
        }
    }
    if slots.len() >= u32::MAX as usize {
        return None;
    }
    slots.try_reserve(1).ok()?;
    slots.push(RenderSlot {
        generation: 1,
        value: Some(value),
    });
    Some(ObjectHandle {
        kind,
        context_id,
        slot: slots.len() as u32,
        generation: 1,
    })
}
fn slot_index<T>(
    slots: &[RenderSlot<T>],
    handle: ObjectHandle,
    kind: ObjectKind,
    context_id: u32,
) -> Option<usize> {
    if handle.kind != kind || handle.context_id != context_id || handle.slot == 0 {
        return None;
    }
    let index = handle.slot as usize - 1;
    let slot = slots.get(index)?;
    (slot.generation == handle.generation && slot.value.is_some()).then_some(index)
}
fn copy<T: Copy>(data: &[T]) -> Option<Vec<T>> {
    let mut result = Vec::new();
    result.try_reserve_exact(data.len()).ok()?;
    result.extend_from_slice(data);
    Some(result)
}
fn text(value: &str) -> Reply {
    Reply::Text(value.encode_utf16().collect())
}
fn components(ty: u32) -> usize {
    match ty {
        FLOAT_VEC2 | 0x8b53 | 0x8b57 => 2,
        FLOAT_VEC3 | 0x8b54 | 0x8b58 => 3,
        FLOAT_VEC4 | 0x8b55 | 0x8b59 => 4,
        0x8b5a => 4,
        0x8b5b => 9,
        0x8b5c => 16,
        _ => 1,
    }
}
fn base_name(name: &str) -> &str {
    name.strip_suffix("[0]").unwrap_or(name)
}

impl ContextCore {
    pub fn configure_surface(&mut self, width: u32, height: u32) {
        self.render.surface = [width, height];
        self.render.raster.scissor = [
            0,
            0,
            width.min(i32::MAX as u32) as i32,
            height.min(i32::MAX as u32) as i32,
        ];
        self.render.raster.viewport = [
            0,
            0,
            width.min(i32::MAX as u32) as i32,
            height.min(i32::MAX as u32) as i32,
        ];
    }
    pub fn configure_context_attributes(&mut self, alpha: bool, depth: bool, stencil: bool) {
        self.render.context_alpha = alpha;
        self.render.context_depth = depth;
        self.render.context_stencil = stencil;
    }
    pub fn configure_texture_units(&mut self, limit: usize) {
        self.render.texture_unit_limit = limit;
    }
    pub fn configure_texture_dimension(&mut self, limit: u32) {
        self.render.texture_dimension_limit = limit;
    }
    pub fn configure_attribute_limit(&mut self, limit: usize) {
        self.render.attribute_limit = limit.min(16);
    }
    pub fn take_artifact_releases(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.render.releases)
    }
    fn shader_index(&mut self, handle: Option<ObjectHandle>) -> Option<usize> {
        let index = handle.and_then(|handle| {
            slot_index(
                &self.render.shaders,
                handle,
                ObjectKind::Shader,
                self.context_id,
            )
        });
        if index.is_none() {
            let retired =
                handle.is_some_and(|handle| self.deleted_handle(handle, ObjectKind::Shader));
            self.record_error(if retired {
                INVALID_VALUE
            } else {
                INVALID_OPERATION
            });
        }
        index
    }
    fn program_index(&mut self, handle: Option<ObjectHandle>) -> Option<usize> {
        let index = handle.and_then(|handle| {
            slot_index(
                &self.render.programs,
                handle,
                ObjectKind::Program,
                self.context_id,
            )
        });
        if index.is_none() {
            let retired =
                handle.is_some_and(|handle| self.deleted_handle(handle, ObjectKind::Program));
            self.record_error(if retired {
                INVALID_VALUE
            } else {
                INVALID_OPERATION
            });
        }
        index
    }
    fn next_request(&mut self) -> Option<u32> {
        match self.render.next_request.checked_add(1) {
            Some(value) => {
                self.render.next_request = value;
                Some(value)
            }
            None => {
                self.record_error(OUT_OF_MEMORY);
                None
            }
        }
    }
    fn release_shader(&mut self, index: usize) {
        let Some(shader) = self.render.shaders[index].value.as_ref() else {
            return;
        };
        if !shader.deleted {
            return;
        }
        let handle = ObjectHandle {
            kind: ObjectKind::Shader,
            context_id: self.context_id,
            slot: index as u32 + 1,
            generation: self.render.shaders[index].generation,
        };
        if self.render.programs.iter().any(|slot| {
            slot.value
                .as_ref()
                .is_some_and(|program| program.shaders.contains(&handle))
        }) {
            return;
        }
        if let Some(shader) = self.render.shaders[index].value.take() {
            if let Some(id) = shader.artifact {
                self.render.releases.push(id);
            }
        }
    }
    fn release_program(&mut self, index: usize) {
        let handle = ObjectHandle {
            kind: ObjectKind::Program,
            context_id: self.context_id,
            slot: index as u32 + 1,
            generation: self.render.programs[index].generation,
        };
        let Some(program) = self.render.programs[index].value.as_ref() else {
            return;
        };
        if !program.deleted || self.render.current == Some(handle) {
            return;
        }
        if let Some(program) = self.render.programs[index].value.take() {
            if let Some(executable) = program.executable {
                self.render.releases.push(executable.id);
            }
            for shader in program.shaders {
                if let Some(index) = slot_index(
                    &self.render.shaders,
                    shader,
                    ObjectKind::Shader,
                    self.context_id,
                ) {
                    self.release_shader(index);
                }
            }
        }
        self.invalidate_locations(handle);
    }
    fn invalidate_locations(&mut self, program: ObjectHandle) {
        for slot in &mut self.render.locations {
            if slot
                .value
                .as_ref()
                .is_some_and(|location| location.program == program)
            {
                slot.value = None;
            }
        }
    }
    pub fn prepare_compile(&mut self, handle: Option<ObjectHandle>) -> Reply {
        if self.lost {
            return Reply::Null;
        }
        let Some(index) = self.shader_index(handle) else {
            return Reply::Null;
        };
        let Some(request_id) = self.next_request() else {
            return Reply::Null;
        };
        let shader = self.render.shaders[index].value.as_mut().unwrap();
        let Some(source) = copy(&shader.source) else {
            self.record_error(OUT_OF_MEMORY);
            return Reply::Null;
        };
        shader.pending = Some(request_id);
        Reply::Compile(CompileRequest {
            request_id,
            shader: handle.unwrap(),
            stage: shader.stage,
            source,
        })
    }
    pub fn commit_compile(
        &mut self,
        handle: ObjectHandle,
        request_id: u32,
        outcome: CompileOutcome,
    ) -> bool {
        if self.lost {
            return false;
        }
        let Some(index) = slot_index(
            &self.render.shaders,
            handle,
            ObjectKind::Shader,
            self.context_id,
        ) else {
            return false;
        };
        let shader = self.render.shaders[index].value.as_mut().unwrap();
        if shader.pending != Some(request_id) {
            return false;
        }
        shader.pending = None;
        if let Some(id) = shader.artifact.replace(outcome.artifact_id) {
            self.render.releases.push(id);
        }
        shader.compiled = outcome.success;
        shader.log = outcome.log;
        true
    }
    pub fn prepare_link(&mut self, handle: Option<ObjectHandle>) -> Reply {
        if self.lost {
            return Reply::Null;
        }
        let Some(index) = self.program_index(handle) else {
            return Reply::Null;
        };
        let Some(request_id) = self.next_request() else {
            return Reply::Null;
        };
        let program = self.render.programs[index].value.as_mut().unwrap();
        if program.link_generation == MAX_SAFE_VERSION {
            self.record_error(OUT_OF_MEMORY);
            return Reply::Null;
        }
        program.link_generation += 1;
        program.pending = Some(request_id);
        program.linked = false;
        program.validated = false;
        let mut vertex_artifact = None;
        let mut fragment_artifact = None;
        for handle in &program.shaders {
            let Some(index) = slot_index(
                &self.render.shaders,
                *handle,
                ObjectKind::Shader,
                self.context_id,
            ) else {
                continue;
            };
            let shader = self.render.shaders[index].value.as_ref().unwrap();
            if shader.stage == VERTEX_SHADER {
                vertex_artifact = shader.artifact;
            } else {
                fragment_artifact = shader.artifact;
            }
        }
        let bindings = program.bindings.clone();
        self.invalidate_locations(handle.unwrap());
        Reply::Link(LinkRequest {
            request_id,
            program: handle.unwrap(),
            vertex_artifact,
            fragment_artifact,
            bindings,
        })
    }
    pub fn commit_link(
        &mut self,
        handle: ObjectHandle,
        request_id: u32,
        outcome: LinkOutcome,
    ) -> bool {
        if self.lost {
            return false;
        }
        let Some(index) = slot_index(
            &self.render.programs,
            handle,
            ObjectKind::Program,
            self.context_id,
        ) else {
            return false;
        };
        if self.render.programs[index].value.as_ref().unwrap().pending != Some(request_id) {
            return false;
        }
        let executable = if outcome.success {
            match self.make_executable(outcome.artifact_id, outcome.layout) {
                Some(value) => Some(value),
                None => return false,
            }
        } else {
            None
        };
        let program = self.render.programs[index].value.as_mut().unwrap();
        program.pending = None;
        program.linked = outcome.success;
        program.log = outcome.log;
        if let Some(old) = program.executable.take() {
            self.render.releases.push(old.id);
        }
        program.executable = executable;
        true
    }
    fn make_executable(&mut self, id: u32, layout: ProgramLayout) -> Option<Executable> {
        if id == 0
            || layout
                .attributes
                .iter()
                .any(|attribute| attribute.location as usize >= self.render.attribute_limit)
            || layout.vertex_bytes as u64 > self.max_buffer_bytes
            || layout.fragment_bytes as u64 > self.max_buffer_bytes
        {
            self.record_error(INVALID_OPERATION);
            return None;
        }
        let mut values = Vec::new();
        if values
            .try_reserve_exact(layout.uniforms.len() + layout.samplers.len())
            .is_err()
        {
            self.record_error(OUT_OF_MEMORY);
            return None;
        }
        for uniform in &layout.uniforms {
            let count = components(uniform.active.ty).checked_mul(uniform.active.size as usize)?;
            if !uniforms::validate_layout(uniform, layout.vertex_bytes, layout.fragment_bytes) {
                self.record_error(INVALID_OPERATION);
                return None;
            }
            let mut data = Vec::new();
            if data.try_reserve_exact(count).is_err() {
                self.record_error(OUT_OF_MEMORY);
                return None;
            }
            data.resize(count, 0);
            values.push(data);
        }
        for sampler in &layout.samplers {
            let mut data = Vec::new();
            if data.try_reserve_exact(sampler.size as usize).is_err() {
                self.record_error(OUT_OF_MEMORY);
                return None;
            }
            data.resize(sampler.size as usize, 0);
            values.push(data);
        }
        let Some(vertex) = zeroed(layout.vertex_bytes.max(16)) else {
            self.record_error(OUT_OF_MEMORY);
            return None;
        };
        let Some(fragment) = zeroed(layout.fragment_bytes.max(16)) else {
            self.record_error(OUT_OF_MEMORY);
            return None;
        };
        Some(Executable {
            id,
            layout,
            values,
            vertex,
            fragment,
        })
    }
    fn valid_name(&mut self, units: &[u16], query: bool) -> Option<String> {
        if units.len() > 256 {
            self.record_error(INVALID_VALUE);
            return None;
        }
        // ESSL 1.00 section 3.1 excludes six printable ASCII symbols and DEL.
        if !units
            .iter()
            .all(|&unit| matches!(unit, 9..=13 | 32..=126) && !b"\"'$@\\`".contains(&(unit as u8)))
        {
            self.record_error(INVALID_VALUE);
            return None;
        }
        let name = String::from_utf16(units).ok()?;
        if name.starts_with("gl_") || name.starts_with("webgl_") || name.starts_with("_webgl_") {
            if !query {
                self.record_error(INVALID_OPERATION);
            }
            return None;
        }
        Some(name)
    }
    pub fn render_invoke(&mut self, operation: &str, args: &[Argument]) -> Reply {
        let arg = |index: usize| args.get(index).unwrap_or(&Argument::Null);
        if self.lost {
            return match operation {
                "isShader" | "isProgram" | "isTexture" | "isFramebuffer" | "isRenderbuffer" => {
                    Reply::Boolean(false)
                }
                "checkFramebufferStatus" => Reply::Number(0x8cdd as f64),
                "getAttribLocation" => Reply::Number(-1.0),
                "getVertexAttribOffset" => Reply::Number(0.0),
                _ => Reply::Null,
            };
        }
        if let Some(reply) = self.readback_invoke(operation, args) {
            return reply;
        }
        if let Some(reply) = self.raster_invoke(operation, args) {
            return reply;
        }
        if let Some(reply) = self.texture_invoke(operation, args) {
            return reply;
        }
        if let Some(reply) = self.framebuffer_invoke(operation, args) {
            return reply;
        }
        match operation {
            "setSurfaceSize" => {
                self.render.surface = [arg(0).number() as u32, arg(1).number() as u32];
            }
            "createShader" => {
                let stage = arg(0).number() as u32;
                if !matches!(stage, VERTEX_SHADER | FRAGMENT_SHADER) {
                    self.record_error(INVALID_ENUM);
                    return Reply::Null;
                }
                let shader = Shader {
                    stage,
                    source: Vec::new(),
                    artifact: None,
                    compiled: false,
                    log: String::new(),
                    deleted: false,
                    pending: None,
                };
                return match insert(
                    &mut self.render.shaders,
                    shader,
                    ObjectKind::Shader,
                    self.context_id,
                ) {
                    Some(handle) => Reply::Handle(handle),
                    None => {
                        self.record_error(OUT_OF_MEMORY);
                        Reply::Null
                    }
                };
            }
            "createProgram" => {
                let program = Program {
                    shaders: Vec::new(),
                    bindings: Vec::new(),
                    executable: None,
                    linked: false,
                    validated: false,
                    log: String::new(),
                    link_generation: 0,
                    deleted: false,
                    pending: None,
                };
                return match insert(
                    &mut self.render.programs,
                    program,
                    ObjectKind::Program,
                    self.context_id,
                ) {
                    Some(handle) => Reply::Handle(handle),
                    None => {
                        self.record_error(OUT_OF_MEMORY);
                        Reply::Null
                    }
                };
            }
            "isShader" => {
                return Reply::Boolean(
                    arg(0)
                        .handle()
                        .and_then(|handle| {
                            slot_index(
                                &self.render.shaders,
                                handle,
                                ObjectKind::Shader,
                                self.context_id,
                            )
                        })
                        .is_some(),
                )
            }
            "isProgram" => {
                return Reply::Boolean(
                    arg(0)
                        .handle()
                        .and_then(|handle| {
                            slot_index(
                                &self.render.programs,
                                handle,
                                ObjectKind::Program,
                                self.context_id,
                            )
                        })
                        .is_some(),
                )
            }
            "deleteShader" => {
                if arg(0).handle().is_none() {
                    return Reply::Null;
                }
                if self.deleted_handle(arg(0).handle().unwrap(), ObjectKind::Shader) {
                    return Reply::Null;
                }
                if let Some(index) = self.shader_index(arg(0).handle()) {
                    self.render.shaders[index].value.as_mut().unwrap().deleted = true;
                    self.release_shader(index);
                }
            }
            "deleteProgram" => {
                if arg(0).handle().is_none() {
                    return Reply::Null;
                }
                if self.deleted_handle(arg(0).handle().unwrap(), ObjectKind::Program) {
                    return Reply::Null;
                }
                if let Some(index) = self.program_index(arg(0).handle()) {
                    self.render.programs[index].value.as_mut().unwrap().deleted = true;
                    self.release_program(index);
                }
            }
            "shaderSource" => {
                if let Some(index) = self.shader_index(arg(0).handle()) {
                    if let Some(source) = copy(arg(1).text()) {
                        let shader = self.render.shaders[index].value.as_mut().unwrap();
                        shader.source = source;
                        shader.pending = None;
                    } else {
                        self.record_error(OUT_OF_MEMORY);
                    }
                }
            }
            "getShaderSource" | "getShaderInfoLog" | "getShaderParameter" => {
                let Some(index) = self.shader_index(arg(0).handle()) else {
                    return Reply::Null;
                };
                let shader = self.render.shaders[index].value.as_ref().unwrap();
                return match operation {
                    "getShaderSource" => Reply::Text(copy(&shader.source).unwrap_or_default()),
                    "getShaderInfoLog" => text(&shader.log),
                    _ => match arg(1).number() as u32 {
                        0x8b80 => Reply::Boolean(shader.deleted),
                        0x8b81 => Reply::Boolean(shader.compiled),
                        0x8b4f => Reply::Number(shader.stage as f64),
                        _ => {
                            self.record_error(INVALID_ENUM);
                            Reply::Null
                        }
                    },
                };
            }
            "attachShader" | "detachShader" => {
                let Some(program_index) = self.program_index(arg(0).handle()) else {
                    return Reply::Null;
                };
                let Some(shader_index) = self.shader_index(arg(1).handle()) else {
                    return Reply::Null;
                };
                let handle = arg(1).handle().unwrap();
                let stage = self.render.shaders[shader_index]
                    .value
                    .as_ref()
                    .unwrap()
                    .stage;
                let program = self.render.programs[program_index].value.as_mut().unwrap();
                let found = program.shaders.iter().position(|shader| *shader == handle);
                if operation == "detachShader" {
                    if let Some(index) = found {
                        program.shaders.remove(index);
                        program.pending = None;
                        self.release_shader(shader_index);
                    } else {
                        self.record_error(INVALID_OPERATION);
                    }
                } else {
                    let duplicate = program.shaders.iter().any(|handle| {
                        slot_index(
                            &self.render.shaders,
                            *handle,
                            ObjectKind::Shader,
                            self.context_id,
                        )
                        .is_some_and(|index| {
                            self.render.shaders[index].value.as_ref().unwrap().stage == stage
                        })
                    });
                    if duplicate {
                        self.record_error(INVALID_OPERATION);
                    } else if program.shaders.try_reserve(1).is_err() {
                        self.record_error(OUT_OF_MEMORY);
                    } else {
                        program.shaders.push(handle);
                        program.pending = None;
                    }
                }
            }
            "getAttachedShaders" => {
                if let Some(index) = self.program_index(arg(0).handle()) {
                    return Reply::Handles(
                        self.render.programs[index]
                            .value
                            .as_ref()
                            .unwrap()
                            .shaders
                            .clone(),
                    );
                }
            }
            "bindAttribLocation" => {
                let Some(index) = self.program_index(arg(0).handle()) else {
                    return Reply::Null;
                };
                if arg(1).number() < 0.0 || arg(1).number() >= self.render.attribute_limit as f64 {
                    self.record_error(INVALID_VALUE);
                    return Reply::Null;
                }
                let Some(name) = self.valid_name(arg(2).text(), false) else {
                    return Reply::Null;
                };
                let program = self.render.programs[index].value.as_mut().unwrap();
                program.pending = None;
                if let Some(binding) = program
                    .bindings
                    .iter_mut()
                    .find(|binding| binding.0 == name)
                {
                    binding.1 = arg(1).number() as u32;
                } else if program.bindings.try_reserve(1).is_err() {
                    self.record_error(OUT_OF_MEMORY);
                } else {
                    program.bindings.push((name, arg(1).number() as u32));
                }
            }
            "useProgram" => {
                if let Some(handle) = arg(0).handle() {
                    let Some(index) = slot_index(
                        &self.render.programs,
                        handle,
                        ObjectKind::Program,
                        self.context_id,
                    ) else {
                        self.record_error(INVALID_OPERATION);
                        return Reply::Null;
                    };
                    let program = self.render.programs[index].value.as_ref().unwrap();
                    if program.deleted || !program.linked {
                        self.record_error(INVALID_OPERATION);
                        return Reply::Null;
                    }
                }
                let previous = self.render.current;
                self.render.current = arg(0).handle();
                if let Some(previous) = previous {
                    if self.render.current != Some(previous) {
                        if let Some(index) = slot_index(
                            &self.render.programs,
                            previous,
                            ObjectKind::Program,
                            self.context_id,
                        ) {
                            self.release_program(index);
                        }
                    }
                }
            }
            "getProgramInfoLog" | "getProgramParameter" | "validateProgram" => {
                let Some(index) = self.program_index(arg(0).handle()) else {
                    return Reply::Null;
                };
                if operation == "validateProgram" {
                    let program = self.render.programs[index].value.as_ref().unwrap();
                    let valid = program.linked
                        && program
                            .executable
                            .as_ref()
                            .is_some_and(|executable| self.sampler_units_valid(executable));
                    let program = self.render.programs[index].value.as_mut().unwrap();
                    program.validated = valid;
                    program.log = if valid {
                        String::new()
                    } else {
                        "Program sampler bindings are invalid.".to_owned()
                    };
                    return Reply::Null;
                }
                let program = self.render.programs[index].value.as_mut().unwrap();
                if operation == "getProgramInfoLog" {
                    return text(&program.log);
                }
                return match arg(1).number() as u32 {
                    0x8b80 => Reply::Boolean(program.deleted),
                    0x8b82 => Reply::Boolean(program.linked),
                    0x8b83 => Reply::Boolean(program.validated),
                    0x8b85 => Reply::Number(program.shaders.len() as f64),
                    0x8b89 => Reply::Number(
                        program
                            .executable
                            .as_ref()
                            .map_or(0, |executable| executable.layout.attributes.len())
                            as f64,
                    ),
                    0x8b86 => Reply::Number(program.executable.as_ref().map_or(0, |executable| {
                        executable.layout.uniforms.len() + executable.layout.samplers.len()
                    }) as f64),
                    _ => {
                        self.record_error(INVALID_ENUM);
                        Reply::Null
                    }
                };
            }
            "getActiveAttrib" | "getActiveUniform" | "getAttribLocation" | "getUniformLocation" => {
                return self.reflect(operation, args)
            }
            "getUniform" => return self.get_uniform(arg(0).handle(), arg(1).handle()),
            "getShaderPrecisionFormat" => {
                if !matches!(arg(0).number() as u32, VERTEX_SHADER | FRAGMENT_SHADER) {
                    self.record_error(INVALID_ENUM);
                    return Reply::Null;
                }
                return match arg(1).number() as u32 {
                    0x8df0..=0x8df2 => Reply::Precision(true),
                    0x8df3..=0x8df5 => Reply::Precision(false),
                    _ => {
                        self.record_error(INVALID_ENUM);
                        Reply::Null
                    }
                };
            }
            "getParameter" => {
                if let Some(reply) = self.raster_query(arg(0).number() as u32) {
                    return reply;
                }
                if let Some(reply) = self.texture_query(arg(0).number() as u32) {
                    return reply;
                }
                if let Some(reply) = self.framebuffer_query(arg(0).number() as u32) {
                    return reply;
                }
                return match arg(0).number() as u32 {
                    0x8b8d => self.render.current.map_or(Reply::Null, Reply::Handle),
                    0x0ba2 => Reply::Floats(
                        self.render
                            .raster
                            .viewport
                            .map(|value| value as f32)
                            .to_vec(),
                    ),
                    0x0c22 => Reply::Floats(self.render.clear_color.to_vec()),
                    0x0b73 => Reply::Number(self.render.clear_depth as f64),
                    _ => {
                        self.record_error(INVALID_ENUM);
                        Reply::Null
                    }
                };
            }
            "enableVertexAttribArray" | "disableVertexAttribArray" => {
                if (arg(0).number() as usize) < self.render.attribute_limit {
                    self.render.attributes[arg(0).number() as usize].enabled =
                        operation == "enableVertexAttribArray";
                } else {
                    self.record_error(INVALID_VALUE);
                }
            }
            "vertexAttribPointer" => return self.vertex_pointer(args),
            "getVertexAttrib" | "getVertexAttribOffset" => {
                return self.get_attribute(operation, args)
            }
            "clear" => {
                let mask = arg(0).number() as u32;
                if mask & !(0x4000 | 0x100 | 0x400) != 0 {
                    self.record_error(INVALID_VALUE);
                    return Reply::Null;
                }
                let Some(target) = self.target_snapshot(true) else {
                    return Reply::Null;
                };
                if mask == 0 || target.width == 0 || target.height == 0 {
                    return Reply::Null;
                }
                if mask & 0x4000 != 0 && !self.prepare_color_write(&target) {
                    return Reply::Null;
                }
                let snapshot = ClearSnapshot {
                    state: self.render.raster,
                    target,
                    mask,
                    color: self.render.clear_color,
                    depth: self.render.clear_depth,
                };
                if mask & 0x4000 != 0 {
                    self.finish_color_write(&target);
                }
                return Reply::Clear(snapshot);
            }
            "drawArrays" | "drawElements" => return self.draw_snapshot(operation, args),
            "flush" => {}
            _ if operation.starts_with("uniform") => return self.set_uniform(operation, args),
            _ if operation.starts_with("vertexAttrib") => self.constant_attribute(operation, args),
            _ => return Reply::Unsupported("operation outside Rust drawing profile"),
        }
        Reply::Null
    }
    fn deleted_handle(&self, handle: ObjectHandle, kind: ObjectKind) -> bool {
        if handle.kind != kind
            || handle.context_id != self.context_id
            || handle.slot == 0
            || handle.generation == 0
        {
            return false;
        }
        let generation = match kind {
            ObjectKind::Shader => self
                .render
                .shaders
                .get(handle.slot as usize - 1)
                .map(|slot| (slot.generation, slot.value.is_none())),
            ObjectKind::Program => self
                .render
                .programs
                .get(handle.slot as usize - 1)
                .map(|slot| (slot.generation, slot.value.is_none())),
            _ => None,
        };
        generation.is_some_and(|(generation, empty)| {
            handle.generation < generation || handle.generation == generation && empty
        })
    }
    fn reflect(&mut self, operation: &str, args: &[Argument]) -> Reply {
        let Some(index) = self.program_index(args.first().and_then(Argument::handle)) else {
            return if operation == "getAttribLocation" {
                Reply::Number(-1.0)
            } else {
                Reply::Null
            };
        };
        if !self.render.programs[index].value.as_ref().unwrap().linked {
            self.record_error(INVALID_OPERATION);
            return if operation == "getAttribLocation" {
                Reply::Number(-1.0)
            } else {
                Reply::Null
            };
        }
        let name = if operation.ends_with("Location") {
            let Some(name) = self.valid_name(args.get(1).map_or(&[], Argument::text), true) else {
                return if operation == "getAttribLocation" {
                    Reply::Number(-1.0)
                } else {
                    Reply::Null
                };
            };
            name
        } else {
            String::new()
        };
        let program = self.render.programs[index].value.as_ref().unwrap();
        let executable = program.executable.as_ref().unwrap();
        match operation {
            "getAttribLocation" => Reply::Number(
                executable
                    .layout
                    .attributes
                    .iter()
                    .find(|attribute| attribute.active.name == name)
                    .map_or(-1.0, |attribute| attribute.location as f64),
            ),
            "getActiveAttrib" | "getActiveUniform" => {
                let index = args.get(1).map_or(0.0, Argument::number) as usize;
                let active = if operation == "getActiveAttrib" {
                    executable
                        .layout
                        .attributes
                        .get(index)
                        .map(|attribute| &attribute.active)
                } else if index < executable.layout.uniforms.len() {
                    executable
                        .layout
                        .uniforms
                        .get(index)
                        .map(|uniform| &uniform.active)
                } else {
                    executable
                        .layout
                        .samplers
                        .get(index - executable.layout.uniforms.len())
                };
                if let Some(active) = active {
                    let mut active = active.clone();
                    if active.size > 1
                        || operation == "getActiveUniform"
                            && executable
                                .layout
                                .uniforms
                                .get(index)
                                .is_some_and(|uniform| uniform.array_stride > 0)
                    {
                        active.name = format!("{}[0]", base_name(&active.name));
                    }
                    Reply::Active(active)
                } else {
                    self.record_error(INVALID_VALUE);
                    Reply::Null
                }
            }
            _ => {
                if name.starts_with("gl_") {
                    return Reply::Null;
                }
                let (base, element) = if let Some((base, suffix)) = name
                    .strip_suffix(']')
                    .and_then(|name| name.rsplit_once('['))
                {
                    let Ok(index) = suffix.parse::<usize>() else {
                        return Reply::Null;
                    };
                    (base, index)
                } else {
                    (name.as_str(), 0)
                };
                let uniform = executable
                    .layout
                    .uniforms
                    .iter()
                    .position(|uniform| {
                        base_name(&uniform.active.name) == base
                            && element < uniform.active.size as usize
                    })
                    .or_else(|| {
                        executable
                            .layout
                            .samplers
                            .iter()
                            .position(|sampler| {
                                base_name(&sampler.name) == base && element < sampler.size as usize
                            })
                            .map(|index| index + executable.layout.uniforms.len())
                    });
                let Some(uniform) = uniform else {
                    return Reply::Null;
                };
                let location = Location {
                    program: args[0].handle().unwrap(),
                    link_generation: program.link_generation,
                    uniform,
                    element,
                };
                for (index, slot) in self.render.locations.iter().enumerate() {
                    if slot.value.as_ref().is_some_and(|old| {
                        old.program == location.program
                            && old.link_generation == location.link_generation
                            && old.uniform == uniform
                            && old.element == element
                    }) {
                        return Reply::Handle(ObjectHandle {
                            kind: ObjectKind::UniformLocation,
                            context_id: self.context_id,
                            slot: index as u32 + 1,
                            generation: slot.generation,
                        });
                    }
                }
                match insert(
                    &mut self.render.locations,
                    location,
                    ObjectKind::UniformLocation,
                    self.context_id,
                ) {
                    Some(handle) => Reply::Handle(handle),
                    None => {
                        self.record_error(OUT_OF_MEMORY);
                        Reply::Null
                    }
                }
            }
        }
    }
    fn location(
        &mut self,
        handle: Option<ObjectHandle>,
        expected: Option<ObjectHandle>,
    ) -> Option<(usize, usize, usize)> {
        let Some(location) = handle
            .and_then(|handle| {
                slot_index(
                    &self.render.locations,
                    handle,
                    ObjectKind::UniformLocation,
                    self.context_id,
                )
            })
            .and_then(|index| self.render.locations[index].value.as_ref())
        else {
            self.record_error(INVALID_OPERATION);
            return None;
        };
        let Some(program_index) = slot_index(
            &self.render.programs,
            location.program,
            ObjectKind::Program,
            self.context_id,
        ) else {
            self.record_error(INVALID_OPERATION);
            return None;
        };
        let program = self.render.programs[program_index].value.as_ref().unwrap();
        if expected != Some(location.program)
            || !program.linked
            || program.link_generation != location.link_generation
        {
            self.record_error(INVALID_OPERATION);
            return None;
        }
        Some((program_index, location.uniform, location.element))
    }
    fn vertex_pointer(&mut self, args: &[Argument]) -> Reply {
        let number = |index: usize| args.get(index).map_or(0.0, Argument::number);
        let index = number(0) as usize;
        let size = number(1);
        let ty = number(2) as u32;
        let stride = number(4);
        let offset = number(5);
        if index >= self.render.attribute_limit
            || !(1.0..=4.0).contains(&size)
            || !(0.0..=255.0).contains(&stride)
            || offset < 0.0
        {
            self.record_error(INVALID_VALUE);
            return Reply::Null;
        }
        let Some(component_bytes) = vertex_component_bytes(ty) else {
            self.record_error(INVALID_ENUM);
            return Reply::Null;
        };
        if stride % component_bytes as f64 != 0.0
            || offset % component_bytes as f64 != 0.0
            || self.array_binding.is_none() && offset != 0.0
        {
            self.record_error(INVALID_OPERATION);
            return Reply::Null;
        }
        let attribute = &mut self.render.attributes[index];
        attribute.buffer = self.array_binding;
        attribute.size = size as u32;
        attribute.ty = ty;
        attribute.normalized = args.get(3).is_some_and(Argument::boolean);
        attribute.stride = stride as u32;
        attribute.offset = offset as usize;
        Reply::Null
    }
    fn constant_attribute(&mut self, operation: &str, args: &[Argument]) {
        let index = args.first().map_or(0.0, Argument::number) as usize;
        let Some(width) = operation
            .strip_prefix("vertexAttrib")
            .and_then(|suffix| suffix.chars().next())
            .and_then(|value| value.to_digit(10))
        else {
            return;
        };
        if index >= self.render.attribute_limit {
            self.record_error(INVALID_VALUE);
            return;
        }
        if operation.ends_with('v')
            && args.get(1).map_or(&[] as &[f32], Argument::floats).len() < width as usize
        {
            self.record_error(INVALID_VALUE);
            return;
        }
        let mut values = [0.0, 0.0, 0.0, 1.0];
        for (index, value) in values.iter_mut().enumerate().take(width.min(4) as usize) {
            *value = if operation.ends_with('v') {
                args.get(1)
                    .map_or(&[] as &[f32], Argument::floats)
                    .get(index)
                    .copied()
                    .unwrap_or(0.0)
            } else {
                args.get(index + 1).map_or(0.0, Argument::number) as f32
            };
        }
        self.render.attributes[index].constant = values;
    }
    fn get_attribute(&mut self, operation: &str, args: &[Argument]) -> Reply {
        let index = args.first().map_or(0.0, Argument::number) as usize;
        let Some(attribute) = self
            .render
            .attributes
            .get(index)
            .filter(|_| index < self.render.attribute_limit)
        else {
            self.record_error(INVALID_VALUE);
            return Reply::Null;
        };
        let parameter = args.get(1).map_or(0.0, Argument::number) as u32;
        if operation == "getVertexAttribOffset" {
            if parameter == 0x8645 {
                return Reply::Number(attribute.offset as f64);
            }
            self.record_error(INVALID_ENUM);
            return Reply::Number(0.0);
        }
        match parameter {
            0x8622 => Reply::Boolean(attribute.enabled),
            0x8623 => Reply::Number(attribute.size as f64),
            0x8625 => Reply::Number(attribute.ty as f64),
            0x886a => Reply::Boolean(attribute.normalized),
            0x8624 => Reply::Number(attribute.stride as f64),
            0x889f => attribute
                .buffer
                .map_or(Reply::Null, |handle| Reply::Handle(handle.into())),
            0x8626 => Reply::Floats(attribute.constant.to_vec()),
            _ => {
                self.record_error(INVALID_ENUM);
                Reply::Null
            }
        }
    }
    fn draw_snapshot(&mut self, operation: &str, args: &[Argument]) -> Reply {
        let number = |index: usize| args.get(index).map_or(0.0, Argument::number);
        let mode = number(0) as u32;
        if mode > 6 {
            self.record_error(INVALID_ENUM);
            return Reply::Null;
        }
        let indexed = operation == "drawElements";
        let first = if indexed { 0.0 } else { number(1) };
        let count = number(if indexed { 1 } else { 2 });
        if first < 0.0 || count < 0.0 {
            self.record_error(INVALID_VALUE);
            return Reply::Null;
        }
        let index_format = if indexed {
            let ty = number(2) as u32;
            let bytes = match ty {
                0x1401 => 1,
                0x1403 => 2,
                _ => {
                    self.record_error(INVALID_ENUM);
                    return Reply::Null;
                }
            };
            let offset = number(3);
            if offset < 0.0 {
                self.record_error(INVALID_VALUE);
                return Reply::Null;
            }
            if offset % bytes as f64 != 0.0 || self.element_binding.is_none() {
                self.record_error(INVALID_OPERATION);
                return Reply::Null;
            }
            Some((ty, bytes, offset as usize))
        } else {
            None
        };
        if !matches!(mode, TRIANGLES | TRIANGLE_STRIP) {
            return Reply::Unsupported("drawing mode other than TRIANGLES or TRIANGLE_STRIP");
        }
        let Some(program_index) = self.program_index(self.render.current) else {
            return Reply::Null;
        };
        if !self.render.programs[program_index]
            .value
            .as_ref()
            .unwrap()
            .linked
        {
            self.record_error(INVALID_OPERATION);
            return Reply::Null;
        }
        if self.render.attributes[..self.render.attribute_limit]
            .iter()
            .any(|attribute| attribute.enabled && attribute.buffer.is_none())
        {
            self.record_error(INVALID_OPERATION);
            return Reply::Null;
        }
        let Some(target) = self.target_snapshot(true) else {
            return Reply::Null;
        };
        if self.render.raster.stencil_test
            && self.target_has_stencil(&target)
            && !self.render.raster.stencil_parameters_match()
        {
            self.record_error(INVALID_OPERATION);
            return Reply::Null;
        }
        let mut indices = None;
        let mut vertex_count = first as usize + count as usize;
        if let Some((ty, bytes, offset)) = index_format {
            let Some(index) = self.bound_index(ELEMENT_ARRAY_BUFFER) else {
                return Reply::Null;
            };
            let buffer = self.slots[index].buffer.as_ref().unwrap();
            let Some(end) = (count as usize)
                .checked_mul(bytes)
                .and_then(|length| offset.checked_add(length))
            else {
                self.record_error(INVALID_OPERATION);
                return Reply::Null;
            };
            if end > buffer.data.len() {
                self.record_error(INVALID_OPERATION);
                return Reply::Null;
            }
            vertex_count = 0;
            for value in buffer.data[offset..end].chunks_exact(bytes) {
                let value = if bytes == 1 {
                    value[0] as usize
                } else {
                    u16::from_le_bytes([value[0], value[1]]) as usize
                };
                vertex_count = vertex_count.max(value + 1);
            }
            let Some(snapshot) = self.inspect_buffer(self.element_binding.unwrap()) else {
                self.record_error(OUT_OF_MEMORY);
                return Reply::Null;
            };
            indices = Some((snapshot, ty, offset));
        }
        let program = self.render.programs[program_index].value.as_ref().unwrap();
        let executable = program.executable.as_ref().unwrap();
        if !self.sampler_units_valid(executable) {
            self.record_error(INVALID_OPERATION);
            return Reply::Null;
        }
        if let Some(color) = self.framebuffer_color_texture() {
            if executable
                .layout
                .samplers
                .iter()
                .enumerate()
                .any(|(index, sampler)| {
                    let unit =
                        executable.values[executable.layout.uniforms.len() + index][0] as usize;
                    self.render
                        .textures
                        .units
                        .get(unit)
                        .and_then(|unit| unit.binding(Self::sampler_target(sampler.ty)))
                        == Some(color)
                })
            {
                self.record_error(INVALID_OPERATION);
                return Reply::Null;
            }
        }
        let Some(textures) = self.sampled_textures(executable) else {
            self.record_error(OUT_OF_MEMORY);
            return Reply::Null;
        };
        let mut attributes = Vec::new();
        if attributes
            .try_reserve_exact(executable.layout.attributes.len())
            .is_err()
        {
            self.record_error(OUT_OF_MEMORY);
            return Reply::Null;
        }
        for active in &executable.layout.attributes {
            if !matches!(
                active.active.ty,
                FLOAT | FLOAT_VEC2 | FLOAT_VEC3 | FLOAT_VEC4
            ) {
                return Reply::Unsupported("matrix vertex attributes");
            }
            let attribute = &self.render.attributes[active.location as usize];
            let data = if attribute.enabled {
                let Some(handle) = attribute.buffer else {
                    self.record_error(INVALID_OPERATION);
                    return Reply::Null;
                };
                let Some(index) = self.live_index(handle) else {
                    self.record_error(INVALID_OPERATION);
                    return Reply::Null;
                };
                let buffer = self.slots[index].buffer.as_ref().unwrap();
                let element_bytes =
                    attribute.size as usize * vertex_component_bytes(attribute.ty).unwrap();
                let stride = if attribute.stride == 0 {
                    element_bytes
                } else {
                    attribute.stride as usize
                };
                let required = if count == 0.0 {
                    Some(0)
                } else {
                    vertex_count
                        .saturating_sub(1)
                        .checked_mul(stride)
                        .and_then(|value| value.checked_add(attribute.offset))
                        .and_then(|value| value.checked_add(element_bytes))
                };
                if required.is_none_or(|required| required > buffer.data.len()) {
                    self.record_error(INVALID_OPERATION);
                    return Reply::Null;
                }
                let Some(snapshot) = self.inspect_buffer(handle) else {
                    self.record_error(OUT_OF_MEMORY);
                    return Reply::Null;
                };
                Some(snapshot)
            } else {
                None
            };
            attributes.push(AttributeDraw {
                location: active.location,
                shader_type: active.active.ty,
                size: attribute.size,
                ty: attribute.ty,
                normalized: attribute.normalized,
                stride: attribute.stride,
                offset: attribute.offset,
                data,
                constant: attribute.constant,
            });
        }
        if count == 0.0
            || target.width == 0
            || target.height == 0
            || self.render.raster.cull && self.render.raster.cull_face == 0x408
        {
            return Reply::Null;
        }
        let Some(vertex_uniforms) = copy_bytes(&executable.vertex) else {
            self.record_error(OUT_OF_MEMORY);
            return Reply::Null;
        };
        let Some(fragment_uniforms) = copy_bytes(&executable.fragment) else {
            self.record_error(OUT_OF_MEMORY);
            return Reply::Null;
        };
        let snapshot = DrawSnapshot {
            artifact_id: executable.id,
            mode,
            program: self.render.current.unwrap(),
            link_generation: program.link_generation,
            state: self.render.raster,
            target,
            attributes,
            vertex_count: vertex_count as u32,
            first: first as u32,
            count: count as u32,
            indices,
            vertex_uniforms,
            fragment_uniforms,
            textures,
        };
        if !self.prepare_color_write(&target) {
            return Reply::Null;
        }
        self.finish_color_write(&target);
        Reply::Draw(snapshot)
    }
}

fn zeroed(length: usize) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    bytes.try_reserve_exact(length).ok()?;
    bytes.resize(length, 0);
    Some(bytes)
}

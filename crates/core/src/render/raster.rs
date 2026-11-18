use super::*;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StencilFace {
    pub func: u32,
    pub reference: i32,
    pub value_mask: u32,
    pub write_mask: u32,
    pub fail: u32,
    pub depth_fail: u32,
    pub pass: u32,
}

impl Default for StencilFace {
    fn default() -> Self {
        Self {
            func: 0x207,
            reference: 0,
            value_mask: u32::MAX,
            write_mask: u32::MAX,
            fail: 0x1e00,
            depth_fail: 0x1e00,
            pass: 0x1e00,
        }
    }
}

impl StencilFace {
    fn effective_parameters(&self) -> (i32, u32, u32) {
        (
            self.reference.clamp(0, 255),
            self.value_mask & 255,
            self.write_mask & 255,
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RasterState {
    pub viewport: [i32; 4],
    pub scissor: [i32; 4],
    pub scissor_test: bool,
    pub color_mask: [bool; 4],
    pub depth_test: bool,
    pub polygon_offset_fill: bool,
    pub polygon_offset_factor: f32,
    pub polygon_offset_units: f32,
    pub depth_mask: bool,
    pub depth_func: u32,
    pub depth_range: [f32; 2],
    pub stencil_test: bool,
    pub stencil_clear: i32,
    pub stencil_front: StencilFace,
    pub stencil_back: StencilFace,
    pub blend: bool,
    pub blend_color: [f32; 4],
    pub blend_src_rgb: u32,
    pub blend_dst_rgb: u32,
    pub blend_src_alpha: u32,
    pub blend_dst_alpha: u32,
    pub blend_equation_rgb: u32,
    pub blend_equation_alpha: u32,
    pub cull: bool,
    pub cull_face: u32,
    pub front_face: u32,
}
impl Default for RasterState {
    fn default() -> Self {
        Self {
            viewport: [0; 4],
            scissor: [0; 4],
            scissor_test: false,
            color_mask: [true; 4],
            depth_test: false,
            polygon_offset_fill: false,
            polygon_offset_factor: 0.0,
            polygon_offset_units: 0.0,
            depth_mask: true,
            depth_func: 0x201,
            depth_range: [0.0, 1.0],
            stencil_test: false,
            stencil_clear: 0,
            stencil_front: StencilFace::default(),
            stencil_back: StencilFace::default(),
            blend: false,
            blend_color: [0.0; 4],
            blend_src_rgb: 1,
            blend_dst_rgb: 0,
            blend_src_alpha: 1,
            blend_dst_alpha: 0,
            blend_equation_rgb: 0x8006,
            blend_equation_alpha: 0x8006,
            cull: false,
            cull_face: 0x405,
            front_face: 0x901,
        }
    }
}
impl RasterState {
    pub(super) fn stencil_parameters_match(&self) -> bool {
        self.stencil_front.effective_parameters() == self.stencil_back.effective_parameters()
    }
}
fn clamped(value: f64) -> f32 {
    if value.is_nan() {
        0.0
    } else {
        (value as f32).clamp(0.0, 1.0)
    }
}
fn factor(value: u32) -> bool {
    matches!(value,0|1|0x300..=0x308|0x8001..=0x8004)
}
fn equation(value: u32) -> bool {
    matches!(value, 0x8006 | 0x800a | 0x800b)
}

impl ContextCore {
    pub(super) fn raster_query(&self, parameter: u32) -> Option<Reply> {
        let state = &self.render.raster;
        let front = &state.stencil_front;
        let back = &state.stencil_back;
        Some(match parameter {
            0x0d50 => Reply::Number(4.0),
            0x8038 => Reply::Number(state.polygon_offset_factor as f64),
            0x2a00 => Reply::Number(state.polygon_offset_units as f64),
            0x80aa => Reply::Number(self.render.sample_coverage_value as f64),
            0x80ab => Reply::Boolean(self.render.sample_coverage_invert),
            0x0ba2 => Reply::Ints(state.viewport.to_vec()),
            0x0c10 => Reply::Ints(state.scissor.to_vec()),
            0x0b21 => Reply::Number(self.render.requested_line_width as f64),
            0x846e => Reply::Floats(vec![1.0, 1.0]),
            0x8192 => Reply::Number(self.render.mipmap_hint as f64),
            0x0c22 => Reply::Floats(self.render.clear_color.to_vec()),
            0x0b73 => Reply::Number(self.render.clear_depth as f64),
            0x0c23 => Reply::Booleans(state.color_mask.to_vec()),
            0x0b72 => Reply::Boolean(state.depth_mask),
            0x0b74 => Reply::Number(state.depth_func as f64),
            0x0b70 => Reply::Floats(state.depth_range.to_vec()),
            0x0b91 => Reply::Number(state.stencil_clear as f64),
            0x0b92 => Reply::Number(front.func as f64),
            0x0b93 => Reply::Number(front.value_mask as f64),
            0x0b94 => Reply::Number(front.fail as f64),
            0x0b95 => Reply::Number(front.depth_fail as f64),
            0x0b96 => Reply::Number(front.pass as f64),
            0x0b97 => Reply::Number(front.reference as f64),
            0x0b98 => Reply::Number(front.write_mask as f64),
            0x8800 => Reply::Number(back.func as f64),
            0x8801 => Reply::Number(back.fail as f64),
            0x8802 => Reply::Number(back.depth_fail as f64),
            0x8803 => Reply::Number(back.pass as f64),
            0x8ca3 => Reply::Number(back.reference as f64),
            0x8ca4 => Reply::Number(back.value_mask as f64),
            0x8ca5 => Reply::Number(back.write_mask as f64),
            0x8005 => Reply::Floats(state.blend_color.to_vec()),
            0x8009 => Reply::Number(state.blend_equation_rgb as f64),
            0x883d => Reply::Number(state.blend_equation_alpha as f64),
            0x80c9 => Reply::Number(state.blend_src_rgb as f64),
            0x80c8 => Reply::Number(state.blend_dst_rgb as f64),
            0x80cb => Reply::Number(state.blend_src_alpha as f64),
            0x80ca => Reply::Number(state.blend_dst_alpha as f64),
            0x0b45 => Reply::Number(state.cull_face as f64),
            0x0b46 => Reply::Number(state.front_face as f64),
            0x0be2 | 0x0b44 | 0x0b71 | 0x0c11 | 0x0bd0 | 0x0b90 | 0x8037 | 0x80a0 | 0x809e => {
                Reply::Boolean(self.enabled(parameter)?)
            }
            _ => return None,
        })
    }
    fn enabled(&self, capability: u32) -> Option<bool> {
        let state = &self.render.raster;
        Some(match capability {
            0x0be2 => state.blend,
            0x0b44 => state.cull,
            0x0b71 => state.depth_test,
            0x0c11 => state.scissor_test,
            0x0bd0 => self.render.dither,
            0x0b90 => state.stencil_test,
            0x8037 => state.polygon_offset_fill,
            0x80a0 => self.render.sample_coverage,
            0x809e => self.render.sample_alpha_to_coverage,
            _ => return None,
        })
    }
    pub(super) fn raster_invoke(&mut self, operation: &str, args: &[Argument]) -> Option<Reply> {
        let number = |index: usize| args.get(index).map_or(0.0, Argument::number);
        let boolean = |index: usize| args.get(index).is_some_and(Argument::boolean);
        match operation {
            "polygonOffset" => {
                self.render.raster.polygon_offset_factor = number(0) as f32;
                self.render.raster.polygon_offset_units = number(1) as f32;
            }
            "sampleCoverage" => {
                self.render.sample_coverage_value = clamped(number(0));
                self.render.sample_coverage_invert = boolean(1);
            }
            "lineWidth" => {
                let width = number(0) as f32;
                if width > 0.0 {
                    self.render.requested_line_width = width;
                } else {
                    self.record_error(INVALID_VALUE);
                }
            }
            "hint" => {
                let target = number(0) as u32;
                let mode = number(1) as u32;
                if target == 0x8192 && matches!(mode, 0x1100..=0x1102) {
                    self.render.mipmap_hint = mode;
                } else {
                    self.record_error(INVALID_ENUM);
                }
            }
            "enable" | "disable" => {
                let capability = number(0) as u32;
                let enabled = operation == "enable";
                match capability {
                    0x0be2 => self.render.raster.blend = enabled,
                    0x0b44 => self.render.raster.cull = enabled,
                    0x0b71 => self.render.raster.depth_test = enabled,
                    0x0c11 => self.render.raster.scissor_test = enabled,
                    0x0bd0 => self.render.dither = enabled,
                    0x0b90 => self.render.raster.stencil_test = enabled,
                    0x8037 => self.render.raster.polygon_offset_fill = enabled,
                    0x80a0 => self.render.sample_coverage = enabled,
                    0x809e => self.render.sample_alpha_to_coverage = enabled,
                    _ => self.record_error(INVALID_ENUM),
                }
            }
            "isEnabled" => {
                return Some(match self.enabled(number(0) as u32) {
                    Some(value) => Reply::Boolean(value),
                    None => {
                        self.record_error(INVALID_ENUM);
                        Reply::Boolean(false)
                    }
                })
            }
            "viewport" | "scissor" => {
                if number(2) < 0.0 || number(3) < 0.0 {
                    self.record_error(INVALID_VALUE);
                } else {
                    let values = [
                        number(0) as i32,
                        number(1) as i32,
                        number(2) as i32,
                        number(3) as i32,
                    ];
                    if operation == "viewport" {
                        let maximum =
                            self.render.texture_dimension_limit.min(i32::MAX as u32) as i32;
                        self.render.raster.viewport = [
                            values[0],
                            values[1],
                            values[2].min(maximum),
                            values[3].min(maximum),
                        ];
                    } else {
                        self.render.raster.scissor = values;
                    }
                }
            }
            "colorMask" => self.render.raster.color_mask = std::array::from_fn(boolean),
            "depthMask" => self.render.raster.depth_mask = boolean(0),
            "depthFunc" => {
                let value = number(0) as u32;
                if (0x200..=0x207).contains(&value) {
                    self.render.raster.depth_func = value;
                } else {
                    self.record_error(INVALID_ENUM);
                }
            }
            "depthRange" => {
                if number(0) > number(1) {
                    self.record_error(INVALID_OPERATION);
                } else {
                    self.render.raster.depth_range = [clamped(number(0)), clamped(number(1))];
                }
            }
            "clearColor" => {
                self.render.clear_color = std::array::from_fn(|index| clamped(number(index)))
            }
            "clearDepth" => self.render.clear_depth = clamped(number(0)),
            "clearStencil" => self.render.raster.stencil_clear = number(0) as i32,
            "stencilMask"
            | "stencilMaskSeparate"
            | "stencilFunc"
            | "stencilFuncSeparate"
            | "stencilOp"
            | "stencilOpSeparate" => self.set_stencil_state(operation, args),
            "blendColor" => {
                self.render.raster.blend_color = std::array::from_fn(|index| clamped(number(index)))
            }
            "cullFace" => {
                let value = number(0) as u32;
                if matches!(value, 0x404 | 0x405 | 0x408) {
                    self.render.raster.cull_face = value;
                } else {
                    self.record_error(INVALID_ENUM);
                }
            }
            "frontFace" => {
                let value = number(0) as u32;
                if matches!(value, 0x900 | 0x901) {
                    self.render.raster.front_face = value;
                } else {
                    self.record_error(INVALID_ENUM);
                }
            }
            "blendEquation" | "blendEquationSeparate" => {
                let rgb = number(0) as u32;
                let alpha = if operation == "blendEquation" {
                    rgb
                } else {
                    number(1) as u32
                };
                if !equation(rgb) || !equation(alpha) {
                    self.record_error(INVALID_ENUM);
                } else {
                    self.render.raster.blend_equation_rgb = rgb;
                    self.render.raster.blend_equation_alpha = alpha;
                }
            }
            "blendFunc" | "blendFuncSeparate" => {
                let values = if operation == "blendFunc" {
                    [
                        number(0) as u32,
                        number(1) as u32,
                        number(0) as u32,
                        number(1) as u32,
                    ]
                } else {
                    std::array::from_fn(|index| number(index) as u32)
                };
                if values.iter().any(|value| !factor(*value))
                    || values[1] == 0x308
                    || values[3] == 0x308
                {
                    self.record_error(INVALID_ENUM);
                } else if values[..2]
                    .iter()
                    .any(|value| matches!(value, 0x8001 | 0x8002))
                    && values[..2]
                        .iter()
                        .any(|value| matches!(value, 0x8003 | 0x8004))
                {
                    self.record_error(INVALID_OPERATION);
                } else {
                    let state = &mut self.render.raster;
                    state.blend_src_rgb = values[0];
                    state.blend_dst_rgb = values[1];
                    state.blend_src_alpha = values[2];
                    state.blend_dst_alpha = values[3];
                }
            }
            _ => return None,
        }
        Some(Reply::Null)
    }

    fn set_stencil_state(&mut self, operation: &str, args: &[Argument]) {
        let separate = operation.ends_with("Separate");
        let number = |index: usize| args.get(index).map_or(0.0, Argument::number);
        let face = if separate { number(0) as u32 } else { 0x408 };
        if !matches!(face, 0x404 | 0x405 | 0x408) {
            return self.record_error(INVALID_ENUM);
        }
        let first = usize::from(separate);
        let value = number(first) as u32;
        let (front, back) = (
            &mut self.render.raster.stencil_front,
            &mut self.render.raster.stencil_back,
        );
        let faces = [
            Some(front).filter(|_| face != 0x405),
            Some(back).filter(|_| face != 0x404),
        ];
        match operation {
            "stencilMask" | "stencilMaskSeparate" => {
                for face in faces.into_iter().flatten() {
                    face.write_mask = value;
                }
            }
            "stencilFunc" | "stencilFuncSeparate" => {
                if !(0x200..=0x207).contains(&value) {
                    return self.record_error(INVALID_ENUM);
                }
                let reference = number(first + 1) as i32;
                let mask = number(first + 2) as u32;
                for face in faces.into_iter().flatten() {
                    face.func = value;
                    face.reference = reference;
                    face.value_mask = mask;
                }
            }
            _ => {
                let depth_fail = number(first + 1) as u32;
                let pass = number(first + 2) as u32;
                if [value, depth_fail, pass]
                    .into_iter()
                    .any(|op| !matches!(op, 0 | 0x1e00..=0x1e03 | 0x150a | 0x8507 | 0x8508))
                {
                    return self.record_error(INVALID_ENUM);
                }
                for face in faces.into_iter().flatten() {
                    face.fail = value;
                    face.depth_fail = depth_fail;
                    face.pass = pass;
                }
            }
        }
    }
}

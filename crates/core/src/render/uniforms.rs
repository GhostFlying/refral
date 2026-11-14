use super::*;

fn matrix_dimension(ty: u32) -> usize {
    match ty {
        0x8b5a => 2,
        0x8b5b => 3,
        0x8b5c => 4,
        _ => 0,
    }
}
fn is_boolean(ty: u32) -> bool {
    matches!(ty, 0x8b56..=0x8b59)
}
fn is_integer(ty: u32) -> bool {
    matches!(ty, 0x1404 | 0x8b53..=0x8b55)
}
fn element_span(uniform: &UniformInfo) -> Option<usize> {
    let dimension = matrix_dimension(uniform.active.ty);
    if dimension == 0 {
        return components(uniform.active.ty).checked_mul(4);
    }
    let stride = uniform.matrix_stride.max(dimension * 4);
    (dimension - 1)
        .checked_mul(stride)?
        .checked_add(dimension * 4)
}
fn element_stride(uniform: &UniformInfo) -> Option<usize> {
    Some(uniform.array_stride.max(element_span(uniform)?))
}
pub(super) fn validate_layout(
    uniform: &UniformInfo,
    vertex_bytes: usize,
    fragment_bytes: usize,
) -> bool {
    if uniform.active.size == 0 {
        return false;
    }
    let Some(span) = element_span(uniform) else {
        return false;
    };
    let Some(stride) = element_stride(uniform) else {
        return false;
    };
    if !stride.is_multiple_of(4) || !uniform.matrix_stride.is_multiple_of(4) {
        return false;
    }
    for (start, length) in [
        (uniform.vertex_offset, vertex_bytes),
        (uniform.fragment_offset, fragment_bytes),
    ] {
        if let Some(start) = start {
            let end = (uniform.active.size as usize - 1)
                .checked_mul(stride)
                .and_then(|value| start.checked_add(value))
                .and_then(|value| value.checked_add(span));
            if start % 4 != 0 || end.is_none_or(|end| end > length) {
                return false;
            }
        }
    }
    true
}

struct Setter {
    width: usize,
    dimension: usize,
    integer: bool,
    vector: bool,
}
fn setter(operation: &str) -> Option<Setter> {
    if let Some(suffix) = operation.strip_prefix("uniformMatrix") {
        let dimension = match suffix {
            "2fv" => 2,
            "3fv" => 3,
            "4fv" => 4,
            _ => return None,
        };
        return Some(Setter {
            width: dimension * dimension,
            dimension,
            integer: false,
            vector: true,
        });
    }
    let suffix = operation.strip_prefix("uniform")?;
    let width = suffix.chars().next()?.to_digit(10)? as usize;
    if !(1..=4).contains(&width) {
        return None;
    }
    let family = suffix.get(1..)?;
    if !matches!(family, "f" | "fv" | "i" | "iv") {
        return None;
    }
    Some(Setter {
        width,
        dimension: 0,
        integer: family.starts_with('i'),
        vector: family.ends_with('v'),
    })
}

impl ContextCore {
    pub(super) fn get_uniform(
        &mut self,
        program: Option<ObjectHandle>,
        location: Option<ObjectHandle>,
    ) -> Reply {
        if self.program_index(program).is_none() {
            return Reply::Null;
        }
        let Some((index, uniform, element)) = self.location(location, program) else {
            return Reply::Null;
        };
        let executable = self.render.programs[index]
            .value
            .as_ref()
            .unwrap()
            .executable
            .as_ref()
            .unwrap();
        let ty = executable
            .layout
            .uniforms
            .get(uniform)
            .map_or(0x8b5e, |uniform| uniform.active.ty);
        let width = components(ty);
        let words = &executable.values[uniform][element * width..(element + 1) * width];
        if is_boolean(ty) {
            return if width == 1 {
                Reply::Boolean(words[0] != 0)
            } else {
                Reply::Booleans(words.iter().map(|word| *word != 0).collect())
            };
        }
        if is_integer(ty) || ty == 0x8b5e {
            return if width == 1 {
                Reply::Number(words[0] as i32 as f64)
            } else {
                Reply::Ints(words.iter().map(|word| *word as i32).collect())
            };
        }
        if width == 1 {
            Reply::Number(f32::from_bits(words[0]) as f64)
        } else {
            Reply::Floats(words.iter().map(|word| f32::from_bits(*word)).collect())
        }
    }

    pub(super) fn set_uniform(&mut self, operation: &str, args: &[Argument]) -> Reply {
        let handle = args.first().and_then(Argument::handle);
        if handle.is_none() {
            return Reply::Null;
        }
        let Some((program_index, uniform_index, element)) =
            self.location(handle, self.render.current)
        else {
            return Reply::Null;
        };
        let Some(setter) = setter(operation) else {
            return Reply::Unsupported("unknown uniform setter");
        };
        if setter.dimension != 0 && args.get(1).is_some_and(Argument::boolean) {
            self.record_error(INVALID_VALUE);
            return Reply::Null;
        }
        let source = args
            .get(if setter.dimension == 0 { 1 } else { 2 })
            .unwrap_or(&Argument::Null);
        let length = if setter.vector {
            match source {
                Argument::Floats(values) if !setter.integer => values.len(),
                Argument::Ints(values) if setter.integer => values.len(),
                _ => 0,
            }
        } else {
            setter.width
        };
        if length < setter.width || length % setter.width != 0 {
            self.record_error(INVALID_VALUE);
            return Reply::Null;
        }
        let executable = self.render.programs[program_index]
            .value
            .as_mut()
            .unwrap()
            .executable
            .as_mut()
            .unwrap();
        let uniform = executable.layout.uniforms.get(uniform_index);
        let ty = uniform.map_or(0x8b5e, |uniform| uniform.active.ty);
        let size = uniform.map_or_else(
            || {
                executable.layout.samplers[uniform_index - executable.layout.uniforms.len()].size
                    as usize
            },
            |uniform| uniform.active.size as usize,
        );
        let sampler = uniform.is_none();
        if sampler && (setter.width != 1 || !setter.integer || setter.dimension != 0)
            || !sampler
                && (components(ty) != setter.width
                    || matrix_dimension(ty) != setter.dimension
                    || !is_boolean(ty) && is_integer(ty) != setter.integer)
        {
            self.record_error(INVALID_OPERATION);
            return Reply::Null;
        }
        let count = length / setter.width;
        let array_name = uniform.map_or_else(
            || &executable.layout.samplers[uniform_index - executable.layout.uniforms.len()].name,
            |uniform| &uniform.active.name,
        );
        if count > 1
            && size == 1
            && !array_name.ends_with("[0]")
            && uniform.is_none_or(|uniform| uniform.array_stride == 0)
        {
            self.record_error(INVALID_OPERATION);
            return Reply::Null;
        }
        let consumed = count.min(size - element) * setter.width;
        let word = |index: usize| -> u32 {
            let numeric = if setter.vector {
                match source {
                    Argument::Floats(values) => values[index] as f64,
                    Argument::Ints(values) => values[index] as f64,
                    _ => 0.0,
                }
            } else {
                args.get(index + 1).map_or(0.0, Argument::number)
            };
            if is_boolean(ty) {
                u32::from(numeric != 0.0)
            } else if setter.integer {
                numeric as i32 as u32
            } else {
                (numeric as f32).to_bits()
            }
        };
        if sampler
            && (0..consumed).any(|index| {
                (word(index) as i32) < 0 || word(index) >= self.render.texture_unit_limit as u32
            })
        {
            self.record_error(INVALID_VALUE);
            return Reply::Null;
        }
        for index in 0..consumed {
            executable.values[uniform_index][element * setter.width + index] = word(index);
        }
        if let Some(uniform) = uniform {
            let stride = element_stride(uniform).unwrap();
            let matrix_stride = uniform.matrix_stride.max(setter.dimension * 4);
            for (bytes, start) in [
                (&mut executable.vertex, uniform.vertex_offset),
                (&mut executable.fragment, uniform.fragment_offset),
            ] {
                if let Some(start) = start {
                    for index in 0..consumed {
                        let component = index % setter.width;
                        let position = if setter.dimension == 0 {
                            component * 4
                        } else {
                            component / setter.dimension * matrix_stride
                                + component % setter.dimension * 4
                        };
                        let offset = start + (element + index / setter.width) * stride + position;
                        bytes[offset..offset + 4].copy_from_slice(&word(index).to_le_bytes());
                    }
                }
            }
        }
        Reply::Null
    }
}

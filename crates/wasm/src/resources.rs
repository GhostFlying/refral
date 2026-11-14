use crate::render::u32_value;
use refral_core::{ResourceOperation, TextureParameters, TextureVersion};

pub(super) fn capacity(operations: &[ResourceOperation]) -> Option<usize> {
    let mut length = 4_usize;
    for operation in operations {
        let size = match operation {
            ResourceOperation::DefineTexture { .. } => 48,
            ResourceOperation::UpdateTexture { .. } => 84,
            ResourceOperation::WriteTexture { .. } => 60,
            ResourceOperation::RetireTexture { .. } => 32,
            ResourceOperation::RetireDepth { .. } => 24,
        };
        length = length.checked_add(size)?;
    }
    Some(length)
}
pub(super) fn version(output: &mut Vec<u8>, version: TextureVersion) {
    for value in [
        version.texture.context_id,
        version.texture.slot,
        version.texture.generation,
    ] {
        u32_value(output, value);
    }
    output.extend_from_slice(&version.storage_generation.to_le_bytes());
    output.extend_from_slice(&version.content_version.to_le_bytes());
}
pub(super) fn parameters(output: &mut Vec<u8>, parameters: TextureParameters) {
    for value in [
        parameters.min_filter,
        parameters.mag_filter,
        parameters.wrap_s,
        parameters.wrap_t,
    ] {
        u32_value(output, value);
    }
}
pub(super) fn target_capacity(target: &refral_core::TargetSnapshot) -> usize {
    20 + if target.color.is_some() { 28 } else { 0 } + if target.depth.is_some() { 20 } else { 0 }
}
pub(super) fn target(output: &mut Vec<u8>, target: refral_core::TargetSnapshot) {
    u32_value(output, target.width);
    u32_value(output, target.height);
    u32_value(output, u32::from(target.is_default));
    u32_value(output, u32::from(target.color.is_some()));
    if let Some(color) = target.color {
        version(output, color);
    }
    u32_value(output, u32::from(target.depth.is_some()));
    if let Some(depth) = target.depth {
        for value in [
            depth.renderbuffer.context_id,
            depth.renderbuffer.slot,
            depth.renderbuffer.generation,
        ] {
            u32_value(output, value);
        }
        output.extend_from_slice(&depth.storage_generation.to_le_bytes());
    }
}
pub(super) fn encode(output: &mut Vec<u8>, operations: &[ResourceOperation]) {
    u32_value(output, operations.len() as u32);
    for operation in operations {
        match operation {
            ResourceOperation::DefineTexture {
                version: next,
                width,
                height,
                data,
            } => {
                u32_value(output, 1);
                version(output, *next);
                u32_value(output, *width);
                u32_value(output, *height);
                u32_value(output, data.as_ptr() as u32);
                u32_value(output, data.len() as u32);
            }
            ResourceOperation::UpdateTexture {
                version: next,
                previous,
                x,
                y,
                width,
                height,
                data,
            } => {
                u32_value(output, 2);
                version(output, *next);
                version(output, *previous);
                for value in [x, y, width, height] {
                    u32_value(output, *value);
                }
                u32_value(output, data.as_ptr() as u32);
                u32_value(output, data.len() as u32);
            }
            ResourceOperation::WriteTexture {
                version: next,
                previous,
            } => {
                u32_value(output, 3);
                version(output, *next);
                version(output, *previous);
            }
            ResourceOperation::RetireTexture { version: next } => {
                u32_value(output, 4);
                version(output, *next);
            }
            ResourceOperation::RetireDepth {
                renderbuffer,
                storage_generation,
            } => {
                u32_value(output, 5);
                for value in [
                    renderbuffer.context_id,
                    renderbuffer.slot,
                    renderbuffer.generation,
                ] {
                    u32_value(output, value);
                }
                output.extend_from_slice(&storage_generation.to_le_bytes());
            }
        }
    }
}

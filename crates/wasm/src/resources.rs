use crate::render::u32_value;
use refral_core::{ResourceOperation, TexelFormat, TextureParameters, TextureVersion};

pub(super) const VERSION_BYTES: usize = 36;
// One generation command can replace six faces at every nonzero level.
const GENERATED_MIP_BYTES: usize = 4 + 2 * VERSION_BYTES + 8;
pub(super) const MAX_OPERATION_HEADERS: usize =
    8 + 6 * (u32::BITS as usize - 1) * GENERATED_MIP_BYTES;

pub(super) fn capacity(operations: &[ResourceOperation]) -> Option<usize> {
    let mut length = 4_usize;
    for operation in operations {
        let size = match operation {
            ResourceOperation::DefineTexture { .. } => 56,
            ResourceOperation::UpdateTexture { .. } => 100,
            ResourceOperation::GenerateTextureMip { .. } => GENERATED_MIP_BYTES,
            ResourceOperation::CopyTexture { previous, copy, .. } => {
                4 + VERSION_BYTES
                    + 4
                    + if previous.is_some() { VERSION_BYTES } else { 0 }
                    + 8
                    + target_capacity(&copy.source)
                    + 32
            }
            ResourceOperation::WriteTexture { .. } => 76,
            ResourceOperation::RetireTexture { .. } => 40,
            ResourceOperation::RetireRenderbuffer { .. } => 24,
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
    u32_value(output, version.image_target);
    u32_value(output, version.level);
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
    20 + if target.color.is_some() {
        VERSION_BYTES
    } else if target.color_renderbuffer.is_some() {
        24
    } else {
        0
    } + if target.depth.is_some() { 20 } else { 0 }
}
pub(super) fn target(output: &mut Vec<u8>, target: refral_core::TargetSnapshot) {
    u32_value(output, target.width);
    u32_value(output, target.height);
    u32_value(output, u32::from(target.is_default));
    if let Some(color) = target.color {
        u32_value(output, if target.color_texture_opaque { 3 } else { 1 });
        version(output, color);
    } else if let Some(color) = target.color_renderbuffer {
        u32_value(output, 2);
        for value in [
            color.renderbuffer.context_id,
            color.renderbuffer.slot,
            color.renderbuffer.generation,
        ] {
            u32_value(output, value);
        }
        output.extend_from_slice(&color.storage_generation.to_le_bytes());
        u32_value(output, color.format);
    } else {
        u32_value(output, 0);
    }
    u32_value(output, target.depth.map_or(0, |depth| depth.format));
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
                texel_format,
            } => {
                u32_value(
                    output,
                    match texel_format {
                        TexelFormat::Unorm8 => 1,
                        TexelFormat::Float32 => 8,
                        TexelFormat::Srgb8 => 9,
                    },
                );
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
            ResourceOperation::GenerateTextureMip {
                version: next,
                source,
                width,
                height,
            } => {
                u32_value(output, 6);
                version(output, *next);
                version(output, *source);
                u32_value(output, *width);
                u32_value(output, *height);
            }
            ResourceOperation::CopyTexture {
                version: next,
                previous,
                width,
                height,
                copy,
            } => {
                u32_value(output, 7);
                version(output, *next);
                u32_value(output, u32::from(previous.is_some()));
                if let Some(previous) = previous {
                    version(output, *previous);
                }
                u32_value(output, *width);
                u32_value(output, *height);
                target(output, copy.source);
                for value in [
                    copy.source_x as u32,
                    copy.source_y as u32,
                    copy.x,
                    copy.y,
                    copy.width,
                    copy.height,
                    copy.format,
                    copy.ty,
                ] {
                    u32_value(output, value);
                }
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
            ResourceOperation::RetireRenderbuffer {
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

#[cfg(test)]
mod tests {
    use super::*;
    use refral_core::{ObjectHandle, ObjectKind};

    #[test]
    fn cube_chain_retirement_fits_preexecution_capacity_and_keeps_image_identity() {
        let operations: Vec<_> = (0..6 * u32::BITS)
            .map(|image| ResourceOperation::RetireTexture {
                version: TextureVersion {
                    texture: ObjectHandle {
                        kind: ObjectKind::Texture,
                        context_id: 7,
                        slot: 3,
                        generation: 2,
                    },
                    storage_generation: 9,
                    content_version: 13,
                    image_target: 0x8515 + image % 6,
                    level: image / 6,
                },
            })
            .collect();
        let expected = capacity(&operations).unwrap();
        let mut encoded = Vec::with_capacity(MAX_OPERATION_HEADERS);
        encode(&mut encoded, &operations);
        encode(&mut encoded, &[]);
        assert_eq!(encoded.len(), expected + 4);
        assert!(encoded.len() <= MAX_OPERATION_HEADERS);
        for image in 0..operations.len() {
            let start = 4 + image * 40;
            assert_eq!(
                u32::from_le_bytes(encoded[start..start + 4].try_into().unwrap()),
                4
            );
            assert_eq!(
                u32::from_le_bytes(encoded[start + 32..start + 36].try_into().unwrap()),
                0x8515 + image as u32 % 6
            );
            assert_eq!(
                u32::from_le_bytes(encoded[start + 36..start + 40].try_into().unwrap()),
                image as u32 / 6
            );
        }
    }
}

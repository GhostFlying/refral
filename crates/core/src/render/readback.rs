use super::*;

#[cfg(test)]
#[path = "readback_tests.rs"]
mod tests;

const RGBA: u32 = 0x1908;
const UNSIGNED_BYTE: u32 = 0x1401;
const IMPLEMENTATION_COLOR_READ_TYPE: u32 = 0x8b9a;
const IMPLEMENTATION_COLOR_READ_FORMAT: u32 = 0x8b9b;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReadPixelsPlan {
    pub target: TargetSnapshot,
    pub source_x: u32,
    pub source_y: u32,
    pub copy_width: u32,
    pub copy_height: u32,
    pub destination_offset: u64,
    pub destination_stride: u64,
    pub required_bytes: u64,
}

impl ContextCore {
    pub(super) fn readback_invoke(&mut self, operation: &str, args: &[Argument]) -> Option<Reply> {
        let arg = |index: usize| args.get(index).unwrap_or(&Argument::Null);
        match operation {
            "getParameter" => {
                let parameter = arg(0).number() as u32;
                let value = match parameter {
                    IMPLEMENTATION_COLOR_READ_TYPE => UNSIGNED_BYTE,
                    IMPLEMENTATION_COLOR_READ_FORMAT => RGBA,
                    _ => return None,
                };
                if self.target_snapshot(false).is_none() {
                    self.record_error(INVALID_OPERATION);
                    return Some(Reply::Null);
                }
                Some(Reply::Number(value as f64))
            }
            "prepareReadPixels" => Some(self.prepare_read_pixels(args)),
            _ => None,
        }
    }

    fn prepare_read_pixels(&mut self, args: &[Argument]) -> Reply {
        let arg = |index: usize| args.get(index).unwrap_or(&Argument::Null);
        let width = arg(2).number() as i32;
        let height = arg(3).number() as i32;
        if matches!(arg(6), Argument::Null) {
            self.record_error(INVALID_VALUE);
            return Reply::Null;
        }
        let format = arg(4).number() as u32;
        let data_type = arg(5).number() as u32;
        if !matches!(format, 0x1906..=0x1908)
            || !matches!(data_type, UNSIGNED_BYTE | 0x8363 | 0x8033 | 0x8034)
        {
            self.record_error(INVALID_ENUM);
            return Reply::Null;
        }
        if width < 0 || height < 0 {
            self.record_error(INVALID_VALUE);
            return Reply::Null;
        }
        if format != RGBA || data_type != UNSIGNED_BYTE {
            self.record_error(INVALID_OPERATION);
            return Reply::Null;
        }
        if !arg(6)
            .text()
            .iter()
            .copied()
            .eq("Uint8Array".encode_utf16())
            && !arg(6)
                .text()
                .iter()
                .copied()
                .eq("Uint8ClampedArray".encode_utf16())
        {
            self.record_error(INVALID_OPERATION);
            return Reply::Null;
        }
        let row_bytes = width as u64 * 4;
        let alignment = self.render.textures.pack_alignment as u64;
        let stride = row_bytes.div_ceil(alignment) * alignment;
        let required = if width == 0 || height == 0 {
            Some(0)
        } else {
            (height as u64 - 1)
                .checked_mul(stride)
                .and_then(|bytes| bytes.checked_add(row_bytes))
        };
        let byte_length = arg(7).number();
        let Some(required_bytes) = required.filter(|bytes| {
            *bytes <= MAX_SAFE_VERSION
                && byte_length.is_finite()
                && byte_length >= 0.0
                && byte_length.fract() == 0.0
                && byte_length <= MAX_SAFE_VERSION as f64
                && *bytes <= byte_length as u64
        }) else {
            self.record_error(INVALID_OPERATION);
            return Reply::Null;
        };
        let Some(target) = self.target_snapshot(true) else {
            return Reply::Null;
        };
        let x = arg(0).number() as i32 as i64;
        let y = arg(1).number() as i32 as i64;
        let source_x = x.max(0);
        let source_y = y.max(0);
        let end_x = (x + width as i64).min(target.width as i64);
        let end_y = (y + height as i64).min(target.height as i64);
        let intersects = source_x < end_x && source_y < end_y;
        Reply::ReadPixelsPlan(ReadPixelsPlan {
            target,
            source_x: if intersects { source_x as u32 } else { 0 },
            source_y: if intersects { source_y as u32 } else { 0 },
            copy_width: if intersects {
                (end_x - source_x) as u32
            } else {
                0
            },
            copy_height: if intersects {
                (end_y - source_y) as u32
            } else {
                0
            },
            destination_offset: if intersects {
                (source_y - y) as u64 * stride + (source_x - x) as u64 * 4
            } else {
                0
            },
            destination_stride: stride,
            required_bytes,
        })
    }
}

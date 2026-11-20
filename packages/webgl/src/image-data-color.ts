// CSS Color 4 §19, combining the linear RGB matrices through their shared D65 white.
const srgbToP3 = [
  [0.822461968714, 0.177538031286, 0],
  [0.033194198851, 0.966805801149, 0],
  [0.017082630721, 0.072397440664, 0.910519928615],
] as const;
const p3ToSrgb = [
  [1.224940176281, -0.224940176281, 0],
  [-0.042056954710, 1.042056954710, 0],
  [-0.019637554590, -0.078636045551, 1.098273600141],
] as const;

const linear = Float64Array.from({ length: 256 }, (_, byte) => {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
});

function encode(value: number): number {
  const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, encoded)) * 255);
}

/** Preserve straight alpha and the caller's ImageData storage. */
export function convertImageDataColor(bytes: Uint8Array, destination: 'srgb' | 'display-p3'): Uint8Array {
  const [red, green, blue] = destination === 'display-p3' ? srgbToP3 : p3ToSrgb;
  const converted = bytes.slice();
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const r = linear[bytes[offset]!]!;
    const g = linear[bytes[offset + 1]!]!;
    const b = linear[bytes[offset + 2]!]!;
    converted[offset] = encode(red[0] * r + red[1] * g);
    converted[offset + 1] = encode(green[0] * r + green[1] * g);
    converted[offset + 2] = encode(blue[0] * r + blue[1] * g + blue[2] * b);
  }
  return converted;
}

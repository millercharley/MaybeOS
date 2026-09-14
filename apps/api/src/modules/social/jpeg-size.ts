/**
 * The width and height of a JPEG, read from its header (SOC-01).
 *
 * Instagram accepts only JPEGs between 4:5 and 1.91:1. Checked here before
 * anything is stored or sent, so a host sees a reason instead of Instagram's
 * error code. Reading the header avoids an image library, which would be a
 * native dependency in a serverless function, for two numbers.
 */
export function jpegSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];

    // Fill bytes, and markers with no length.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;

    // Start-of-frame markers carry the size. C4, C8 and CC share the range
    // but are tables, not frames.
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (offset + 9 > buffer.length) return null;
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }

    offset += 2 + length;
  }
  return null;
}

/** Instagram's feed limits: no taller than 4:5, no wider than 1.91:1. */
export const IG_MIN_RATIO = 4 / 5;
export const IG_MAX_RATIO = 1.91;

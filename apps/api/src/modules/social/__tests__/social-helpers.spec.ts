import { jpegSize } from '../jpeg-size';
import { CAPTION_LIMIT, normaliseHandle } from '../social-caption';

/** A real-shaped JPEG header: SOI, an APP0 segment, a DHT table (whose marker sits in the SOF range), then SOF0. */
function jpeg(width: number, height: number, marker = 0xc0): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const dht = Buffer.from([0xff, 0xc4, 0x00, 0x05, 0x00, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xff00 | marker, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, dht, sof, Buffer.from([0xff, 0xd9])]);
}

describe('jpegSize', () => {
  it('reads the frame size, skipping a table whose marker is in the frame range', () => {
    expect(jpegSize(jpeg(1080, 1350))).toEqual({ width: 1080, height: 1350 });
  });

  it('reads progressive JPEGs too', () => {
    expect(jpegSize(jpeg(1440, 754, 0xc2))).toEqual({ width: 1440, height: 754 });
  });

  it('refuses anything that is not a JPEG', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(jpegSize(png)).toBeNull();
    expect(jpegSize(Buffer.from([0xff, 0xd8, 0x00]))).toBeNull();
  });
});

describe('normaliseHandle', () => {
  it('accepts a username with or without the @, lowercased', () => {
    expect(normaliseHandle('@Maybe.Its_Fate')).toBe('maybe.its_fate');
    expect(normaliseHandle('host')).toBe('host');
  });

  it('refuses what Instagram would', () => {
    expect(normaliseHandle('two words')).toBeNull();
    expect(normaliseHandle('.dot')).toBeNull();
    expect(normaliseHandle('x'.repeat(31))).toBeNull();
    expect(normaliseHandle('')).toBeNull();
    expect(normaliseHandle(null)).toBeNull();
  });
});

/**
 * What is left of the captions file (SOC-04).
 *
 * The builders that put a host's words, their credit and the RSVP link
 * together went with member sharing. Instagram's own limit did not — the
 * co-op's weekly post is bound by exactly the same 2,200 characters.
 */
describe('Instagram’s caption limit', () => {
  it('is the number Instagram enforces, not a number we chose', () => {
    expect(CAPTION_LIMIT).toBe(2200);
  });
});

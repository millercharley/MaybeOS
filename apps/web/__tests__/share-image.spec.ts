import { readFileSync } from 'fs';
import { join } from 'path';
import {
  IG_MIN_WIDTH,
  MAX_JPEG_BYTES,
  MAX_SOURCE_BYTES,
  prepareFromBlob,
  prepareFromUrl,
} from '@/lib/instagram-image';

/**
 * Choosing the picture that goes out (SOC-03).
 *
 * Charley: "ask the user for an image. Supply the existing image attached to
 * the event IF there is one, and allow for the user to choose a different
 * image if desired… Make sure this flow satisfies the Instagram and Facebook
 * APIs."
 *
 * Instagram's content publishing API takes JPEG only, between 4:5 and
 * 1.91:1, at least 320 across, under 8MB, fetched from a public URL. The
 * browser does the cropping and the re-encoding so the host sees exactly
 * what will be posted; the API checks all of it again, because a browser is
 * not a trusted source.
 */

/** A canvas that records what was drawn and answers with a JPEG of a chosen size. */
function stubCanvas(bytesAtQuality: (q: number) => number) {
  const calls = { fill: 0, draw: 0, fillStyle: '' };
  const ctx = {
    set fillStyle(v: string) {
      calls.fillStyle = v;
    },
    get fillStyle() {
      return calls.fillStyle;
    },
    fillRect: () => {
      calls.fill += 1;
    },
    drawImage: () => {
      calls.draw += 1;
    },
  };

  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  jest
    .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
    .mockImplementation((_type?: string, quality?: number) => {
      // 4 base64 characters carry 3 bytes.
      const chars = Math.ceil((bytesAtQuality(quality ?? 0.9) * 4) / 3);
      return `data:image/jpeg;base64,${'A'.repeat(chars)}`;
    });

  return calls;
}

function stubBitmap(width: number, height: number) {
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = jest
    .fn()
    .mockResolvedValue({ width, height, close: jest.fn() });
}

const blobOf = (size: number) => ({ size }) as Blob;

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
});

describe('preparing a picture the host chose', () => {
  it('crops it to Instagram’s range and says what it did', async () => {
    stubBitmap(4000, 3000);
    stubCanvas(() => 200_000);

    const out = await prepareFromBlob(blobOf(2_000_000));

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // 4000×3000 is 1.33:1, inside the range, so only scaled to 1440 wide.
    expect(out.width).toBe(1440);
    expect(out.height).toBe(1080);
    expect(out.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(out.base64.startsWith('data:')).toBe(false);
  });

  it('paints white behind the picture before drawing it', async () => {
    /*
      A JPEG cannot carry transparency, and a PNG's transparent corners come
      out black without this — which on a poster with a cut-out logo is the
      whole image ruined.
    */
    stubBitmap(1080, 1080);
    const calls = stubCanvas(() => 100_000);

    await prepareFromBlob(blobOf(500_000));

    expect(calls.fillStyle).toBe('#ffffff');
    expect(calls.fill).toBe(1);
    expect(calls.draw).toBe(1);
  });

  it('steps the quality down until it fits', async () => {
    // A noisy picture can exceed the limit at 0.9 and fit at 0.8. Finding
    // that out after the host has confirmed it is the worst time.
    stubBitmap(1440, 1440);
    const sizes: Record<string, number> = {
      '0.9': MAX_JPEG_BYTES + 1,
      '0.8': MAX_JPEG_BYTES - 1,
    };
    stubCanvas((q) => sizes[String(q)] ?? 1_000);

    const out = await prepareFromBlob(blobOf(9_000_000));

    expect(out.ok).toBe(true);
    if (out.ok) expect(out.bytes).toBeLessThanOrEqual(MAX_JPEG_BYTES);
  });

  it('gives up rather than sending something the upload will refuse', async () => {
    stubBitmap(1440, 1440);
    stubCanvas(() => MAX_JPEG_BYTES * 2);

    const out = await prepareFromBlob(blobOf(9_000_000));

    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/too detailed/);
  });

  it('refuses a picture too small for Instagram, and says how small', async () => {
    stubBitmap(200, 200);
    stubCanvas(() => 1_000);

    const out = await prepareFromBlob(blobOf(10_000));

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toContain(String(IG_MIN_WIDTH));
      expect(out.reason).toContain('200');
    }
  });

  it('refuses a file too large to open, without trying to decode it', async () => {
    // Decoding a 50MB camera file into a canvas is how the tab dies.
    const decode = jest.fn();
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = decode;

    const out = await prepareFromBlob(blobOf(MAX_SOURCE_BYTES + 1));

    expect(out.ok).toBe(false);
    expect(decode).not.toHaveBeenCalled();
  });

  it('names HEIC when the browser cannot decode it', async () => {
    /*
      An iPhone produces HEIC by default and Chrome cannot read it. "That
      picture could not be opened" leaves somebody staring at a file that
      looks perfectly fine in their own photo library.
    */
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = jest
      .fn()
      .mockRejectedValue(new Error('unsupported'));

    const out = await prepareFromBlob(blobOf(3_000_000));

    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/HEIC/);
  });
});

describe('the picture already on the event', () => {
  it('is used when it can be read', async () => {
    stubBitmap(1080, 1080);
    stubCanvas(() => 100_000);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => blobOf(400_000) });

    expect((await prepareFromUrl('https://example.test/poster.jpg')).ok).toBe(true);
  });

  it('points at the file picker when another site will not let us read it', async () => {
    /*
      This was the dead end. A picture pasted in from elsewhere fails CORS,
      and the host was told to "edit the event and upload the picture
      instead" — a trip to another screen. The answer is now in this dialog.
    */
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const out = await prepareFromUrl('https://elsewhere.test/poster.jpg');

    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/Choose a picture instead/);
  });

  it('says so when the picture is simply gone', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false });

    const out = await prepareFromUrl('https://example.test/missing.jpg');

    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/Choose a picture instead/);
  });
});

describe('the dialog', () => {
  /*
    Comments stripped: the doc comment explaining what was removed quotes
    the very text asserted against below, so the guard passed against the
    old behaviour still being there.
  */
  const src = readFileSync(
    join(__dirname, '..', 'components', 'events', 'share-event-dialog.tsx'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('offers the event’s picture without requiring it', () => {
    expect(src).toMatch(/prepareFromUrl\(o\.imageUrl\)/);
    expect(src).toMatch(/setSource\('event'\)/);
  });

  it('lets the host choose a different one', () => {
    expect(src).toMatch(/type="file"/);
    expect(src).toMatch(/prepareFromBlob\(file\)/);
    expect(src).toMatch(/Use a different picture/);
  });

  it('will not post without a picture', () => {
    // Instagram refuses a post with no image, and the old dialog's answer
    // was to send the host away to edit the event.
    const at = src.indexOf('onClick={share}');
    expect(src.slice(at, at + 220)).toMatch(/!ready/);
  });

  it('shows the picture before it goes, at the size it will go', () => {
    expect(src).toMatch(/alt="The picture as it will be posted"/);
    expect(src).toMatch(/cropped to\{' '\}/);
  });

  it('accepts what a phone will hand it', () => {
    // HEIC is listed so the picker does not silently exclude the file an
    // iPhone offers; `prepareFromBlob` then explains it.
    expect(src).toMatch(/image\/jpeg/);
    expect(src).toMatch(/image\/heic/);
  });

  it('no longer sends anyone away to edit the event', () => {
    expect(src).not.toMatch(/Add one to the event first/);
    expect(src).not.toMatch(/needsImage/);
  });
});

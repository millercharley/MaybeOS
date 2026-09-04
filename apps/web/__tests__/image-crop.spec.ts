import {
  coverScale, clampOffset, sourceRect, outputSize, approximateBytes,
} from '@/lib/image-crop';

/**
 * The geometry behind cropping a room's image (SPC-17).
 *
 * All of this is arithmetic on purpose — the canvas work is three lines around
 * it — because the failures here are silent. An off-by-one in the source
 * rectangle is not an exception, it is a picture with somebody's head cut off.
 */
describe('cropping an image', () => {
  const FRAME = { width: 300, height: 200 }; // 3:2

  describe('the zoom floor', () => {
    it('scales a wide image to meet the frame’s height', () => {
      // 1000×400 into 300×200: height is the binding constraint.
      expect(coverScale({ width: 1000, height: 400 }, FRAME)).toBeCloseTo(0.5);
    });

    it('scales a tall image to meet the frame’s width', () => {
      // The poster case: 1333×2000 into a 3:2 frame.
      expect(coverScale({ width: 1333, height: 2000 }, FRAME)).toBeCloseTo(300 / 1333);
    });

    it('never leaves a gap at an edge', () => {
      // A cover image with a white stripe down one side is the thing cropping
      // exists to prevent.
      const natural = { width: 1333, height: 2000 };
      const s = coverScale(natural, FRAME);
      expect(natural.width * s).toBeGreaterThanOrEqual(FRAME.width - 0.001);
      expect(natural.height * s).toBeGreaterThanOrEqual(FRAME.height - 0.001);
    });
  });

  describe('keeping the frame inside the image', () => {
    const natural = { width: 1000, height: 1000 };
    const scale = 0.5; // displayed 500×500 behind a 300×200 frame

    it('refuses to drag past the top-left', () => {
      expect(clampOffset({ x: 80, y: 40 }, natural, FRAME, scale)).toEqual({ x: 0, y: 0 });
    });

    it('refuses to drag past the bottom-right', () => {
      // 300 - 500 = -200 is as far left as the image may go.
      expect(clampOffset({ x: -900, y: -900 }, natural, FRAME, scale)).toEqual({
        x: -200,
        y: -300,
      });
    });

    it('leaves a legal position alone', () => {
      expect(clampOffset({ x: -50, y: -120 }, natural, FRAME, scale)).toEqual({
        x: -50,
        y: -120,
      });
    });

    it('centres an image too small to cover, rather than pinning it', () => {
      // Should not happen — the zoom floor prevents it — but inverted
      // arithmetic here would put the image somewhere absurd rather than fail.
      const tiny = { width: 100, height: 100 };
      expect(clampOffset({ x: -999, y: -999 }, tiny, FRAME, 1)).toEqual({ x: 100, y: 50 });
    });
  });

  describe('which part of the original ends up stored', () => {
    it('reads the rectangle in the original’s own pixels', () => {
      // Not in screen pixels: a crop taken off a 400px preview would be a
      // 400px image however large the upload was.
      const rect = sourceRect({ width: 1000, height: 1000 }, FRAME, 0.5, { x: -100, y: -50 });
      expect(rect).toEqual({ x: 200, y: 100, width: 600, height: 400 });
    });

    it('keeps the frame’s aspect ratio whatever the zoom', () => {
      for (const scale of [0.3, 0.5, 1, 2.5]) {
        const rect = sourceRect({ width: 4000, height: 3000 }, FRAME, scale, { x: 0, y: 0 });
        expect(rect.width / rect.height).toBeCloseTo(FRAME.width / FRAME.height);
      }
    });
  });

  describe('how big it is stored', () => {
    it('caps the long edge', () => {
      expect(outputSize({ x: 0, y: 0, width: 4000, height: 2667 }, 1600)).toEqual({
        width: 1600,
        height: 1067,
      });
    });

    it('never upscales a small original', () => {
      // A bigger file with no more detail in it is the opposite of the point.
      expect(outputSize({ x: 0, y: 0, width: 300, height: 200 }, 1600)).toEqual({
        width: 300,
        height: 200,
      });
    });

    it('keeps the aspect ratio when it caps', () => {
      const out = outputSize({ x: 0, y: 0, width: 3000, height: 2000 }, 1600);
      expect(out.width / out.height).toBeCloseTo(1.5);
    });

    it('never rounds a dimension to nothing', () => {
      const out = outputSize({ x: 0, y: 0, width: 1000, height: 1 }, 100);
      expect(out.height).toBeGreaterThanOrEqual(1);
    });
  });

  describe('a frame that never measured', () => {
    // This happened, in a browser reporting a 0×0 viewport: the frame
    // measured zero and a **1×1 image** was uploaded without complaint. The
    // cropper refuses a zero frame outright now. These assertions record why
    // that guard exists — the clamp below is correct in isolation and
    // catastrophic if anything reaches it.
    it('produces a rectangle with no area', () => {
      const rect = sourceRect({ width: 4000, height: 3000 }, { width: 0, height: 0 }, 1, { x: 0, y: 0 });
      expect(rect.width).toBe(0);
      expect(rect.height).toBe(0);
    });

    it('and the size clamp turns that into 1×1, which is why it must not get there', () => {
      expect(outputSize({ x: 0, y: 0, width: 0, height: 0 }, 1600)).toEqual({ width: 1, height: 1 });
    });
  });

  it('estimates the decoded weight of a data URL', () => {
    // Four base64 characters carry three bytes.
    expect(approximateBytes('data:image/webp;base64,' + 'A'.repeat(400))).toBe(300);
  });
});

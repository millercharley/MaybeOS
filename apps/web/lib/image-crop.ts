/**
 * Cropping and shrinking an image before it is uploaded (SPC-17).
 *
 * Charley: an admin should be able to crop a room's image after choosing it,
 * and the system should shrink it for storage. Both happen here, in the
 * browser, before a single byte crosses the network — which is not only about
 * storage. The API takes images as base64 inside a JSON body (D-005), and
 * base64 inflates by about a third, so a 9 MB photo off a phone becomes a 12 MB
 * request that Netlify refuses at 6 MB. Shrinking first is what makes a
 * photograph from a modern camera uploadable at all.
 *
 * The geometry is separated from the canvas work so it can be tested without a
 * DOM: everything above `renderCrop` is arithmetic.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Offset {
  x: number;
  y: number;
}

/** The rectangle of the original image that ends up in the crop. */
export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The smallest scale at which the image still covers the frame.
 *
 * This is the zoom floor, not a starting suggestion: below it the frame would
 * show empty space at an edge, and a cover image with a white stripe down one
 * side is the thing cropping exists to prevent.
 */
export function coverScale(natural: Size, frame: Size): number {
  if (natural.width <= 0 || natural.height <= 0) return 1;
  return Math.max(frame.width / natural.width, frame.height / natural.height);
}

/**
 * Keep the frame inside the image.
 *
 * Dragging is unconstrained until it is clamped, and an unclamped drag is how
 * somebody ends up cropping the wall beside the photograph. Clamping at the
 * edges also gives the interaction its feel — it stops rather than drifting.
 */
export function clampOffset(offset: Offset, natural: Size, frame: Size, scale: number): Offset {
  const displayed = { width: natural.width * scale, height: natural.height * scale };

  // If the image is somehow narrower than the frame, centre it rather than
  // pinning it to an edge — the arithmetic below would otherwise invert.
  const clamp = (value: number, displayedLength: number, frameLength: number) => {
    const min = frameLength - displayedLength;
    if (min > 0) return min / 2;
    return Math.min(0, Math.max(min, value));
  };

  return {
    x: clamp(offset.x, displayed.width, frame.width),
    y: clamp(offset.y, displayed.height, frame.height),
  };
}

/**
 * Which part of the original the frame is currently showing.
 *
 * In the original's own pixels, so the output is rendered from the full-size
 * image rather than from whatever the screen happened to be displaying — a
 * crop taken off a 400px preview would be a 400px image however large the
 * upload was.
 */
export function sourceRect(
  natural: Size,
  frame: Size,
  scale: number,
  offset: Offset,
): SourceRect {
  const safe = scale > 0 ? scale : 1;
  return {
    x: -offset.x / safe,
    y: -offset.y / safe,
    width: frame.width / safe,
    height: frame.height / safe,
  };
}

/**
 * How big the stored image should be.
 *
 * Capped on the long edge rather than by file size: a fixed pixel ceiling is
 * predictable, and quality does the rest. Never upscales — a small original
 * blown up to the ceiling is a bigger file with no more detail in it, which is
 * the opposite of the point.
 */
export function outputSize(crop: SourceRect, maxLongEdge: number): Size {
  const longest = Math.max(crop.width, crop.height);
  const scale = longest > maxLongEdge ? maxLongEdge / longest : 1;
  return {
    width: Math.max(1, Math.round(crop.width * scale)),
    height: Math.max(1, Math.round(crop.height * scale)),
  };
}

/** What the uploader asks for. WebP unless the browser will not make one. */
export interface RenderOptions {
  maxLongEdge?: number;
  quality?: number;
}

/**
 * Draw the crop and hand back a data URL.
 *
 * WebP, because it is roughly a third the size of the equivalent JPEG at the
 * same quality and every browser that can run this app can write it. If a
 * browser somehow refuses, `toDataURL` falls back to PNG on its own and the
 * result is still correct — larger, but correct, which is the right way round
 * for a fallback.
 *
 * The white fill matters: WebP and JPEG have no transparency to fall back on,
 * and a transparent PNG cropped onto an unfilled canvas comes out with black
 * where the transparency was.
 */
export function renderCrop(
  image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number },
  crop: SourceRect,
  { maxLongEdge = 1600, quality = 0.82 }: RenderOptions = {},
): { dataUrl: string; mimeType: string } {
  const out = outputSize(crop, maxLongEdge);

  const canvas = document.createElement('canvas');
  canvas.width = out.width;
  canvas.height = out.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare that image.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    image,
    crop.x, crop.y, crop.width, crop.height,
    0, 0, out.width, out.height,
  );

  const dataUrl = canvas.toDataURL('image/webp', quality);
  // A browser that cannot encode WebP returns a PNG data URL instead, without
  // saying so. Read the type back off the result rather than assuming.
  const mimeType = dataUrl.slice(5, dataUrl.indexOf(';'));
  return { dataUrl, mimeType };
}

/** Roughly what a base64 data URL weighs once decoded. */
export function approximateBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.round((base64.length * 3) / 4);
}

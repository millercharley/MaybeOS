/**
 * Fitting an event picture to Instagram (SOC-01).
 *
 * Instagram takes JPEGs no taller than 4:5 and no wider than 1.91:1. A picture
 * already inside that range is kept whole; one outside it is cropped from the
 * centre to the nearest edge of the range, so as little as possible is lost.
 * Scaled down to 1440 pixels wide at most, which is what Instagram stores.
 */

export const IG_MIN_RATIO = 4 / 5;
export const IG_MAX_RATIO = 1.91;
export const IG_MAX_WIDTH = 1440;

/** Instagram refuses anything narrower, and the API checks it again. */
export const IG_MIN_WIDTH = 320;

/**
 * What the co-op's storage will take, which is stricter than Instagram's own
 * 8MB. Checked here so the host is told before the post is attempted, not by
 * a failed upload halfway through.
 */
export const MAX_JPEG_BYTES = 5 * 1024 * 1024;

/**
 * The largest file worth opening in a browser tab.
 *
 * Not an Instagram rule — a phone camera's raw output decoded into a canvas
 * is tens of megabytes of memory, and the tab dying is a worse answer than
 * "that one is too big".
 */
export const MAX_SOURCE_BYTES = 30 * 1024 * 1024;

export interface Crop {
  /** The part of the source image to keep. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** The size to draw it at. */
  width: number;
  height: number;
}

export function instagramCrop(width: number, height: number): Crop {
  const ratio = width / height;
  let sw = width;
  let sh = height;
  if (ratio < IG_MIN_RATIO) sh = Math.round(width / IG_MIN_RATIO);
  else if (ratio > IG_MAX_RATIO) sw = Math.round(height * IG_MAX_RATIO);

  const scale = Math.min(1, IG_MAX_WIDTH / sw);
  return {
    sx: Math.round((width - sw) / 2),
    sy: Math.round((height - sh) / 2),
    sw,
    sh,
    width: Math.round(sw * scale),
    height: Math.round(sh * scale),
  };
}

/**
 * A picture ready to post, or the reason it is not (SOC-03).
 *
 * The reason is shown to the host, so each one says what they can do about
 * it. The old version returned null for every kind of failure and the dialog
 * guessed at one explanation — "it's hosted on another site" — which was
 * right for the CORS case and wrong for a picture that was simply too small.
 */
export type Prepared =
  | {
      ok: true;
      /** The JPEG, for the API. */
      base64: string;
      /** The same bytes, for an <img> the host can look at before posting. */
      dataUrl: string;
      width: number;
      height: number;
      bytes: number;
    }
  | { ok: false; reason: string };

/** How big the base64 of a JPEG actually is on the wire. */
function bytesOf(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Crop a picture the host has chosen to something Instagram will take.
 *
 * Instagram's content publishing API accepts JPEG only — no PNG, no WebP, no
 * HEIC — so everything is re-encoded through a canvas whatever it arrived as.
 * That also flattens transparency, which a JPEG cannot carry and which would
 * otherwise come out black.
 */
export async function prepareFromBlob(blob: Blob): Promise<Prepared> {
  if (blob.size > MAX_SOURCE_BYTES) {
    return { ok: false, reason: 'That picture is too large to open. Try one under 30MB.' };
  }

  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) {
    /*
      Chrome and Firefox cannot decode HEIC, which is what an iPhone produces
      unless it has been told otherwise — far and away the likeliest way to
      arrive here, so it is worth naming rather than saying "unreadable".
    */
    return {
      ok: false,
      reason:
        'That picture could not be opened. If it came from an iPhone it may be HEIC — open it and export as JPEG, or take a screenshot of it.',
    };
  }

  const crop = instagramCrop(bitmap.width, bitmap.height);
  if (crop.width < IG_MIN_WIDTH) {
    bitmap.close();
    return {
      ok: false,
      reason: `That picture is too small — Instagram needs at least ${IG_MIN_WIDTH} pixels across, and this one is ${crop.width}.`,
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return { ok: false, reason: 'This browser could not prepare the picture.' };
  }
  // White behind transparent PNGs; JPEG has no transparency and would go black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, crop.width, crop.height);
  ctx.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.width, crop.height);
  bitmap.close();

  /*
    Quality is stepped down rather than fixed. At 1440 across a photograph is
    usually a few hundred kilobytes at 0.9, but a noisy one need not be, and
    a picture refused by the upload after the host has confirmed it is the
    worst place to find out.
  */
  for (const quality of [0.9, 0.8, 0.7, 0.6]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
    const bytes = bytesOf(base64);
    if (bytes <= MAX_JPEG_BYTES) {
      return { ok: true, base64, dataUrl, width: crop.width, height: crop.height, bytes };
    }
  }

  return { ok: false, reason: 'That picture is too detailed to compress for Instagram. Try a different one.' };
}

/**
 * The same, for a picture already on the event.
 *
 * Reading its pixels needs the host that serves it to allow it. Ours does;
 * a picture pasted in from somewhere else does not, and that is the one case
 * where the answer is to choose a file instead — which the dialog now offers,
 * so this is no longer a dead end.
 */
export async function prepareFromUrl(imageUrl: string): Promise<Prepared> {
  let blob: Blob;
  try {
    const response = await fetch(imageUrl, { mode: 'cors' });
    if (!response.ok) {
      return { ok: false, reason: 'The event’s picture could not be fetched. Choose a picture instead.' };
    }
    blob = await response.blob();
  } catch {
    return {
      ok: false,
      reason: 'The event’s picture is hosted somewhere that will not let us read it. Choose a picture instead.',
    };
  }

  return prepareFromBlob(blob);
}

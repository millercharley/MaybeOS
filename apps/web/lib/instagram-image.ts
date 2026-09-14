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
 * Loads the picture, crops it and returns a base64 JPEG, or null when the
 * browser is not allowed to read the picture's pixels. That happens with a
 * picture on another site that does not allow it; the host is then told to
 * upload the picture instead.
 */
export async function instagramJpeg(imageUrl: string): Promise<{ base64: string; dataUrl: string } | null> {
  let blob: Blob;
  try {
    const response = await fetch(imageUrl, { mode: 'cors' });
    if (!response.ok) return null;
    blob = await response.blob();
  } catch {
    return null;
  }

  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) return null;

  const crop = instagramCrop(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // White behind transparent PNGs; JPEG has no transparency and would go black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, crop.width, crop.height);
  ctx.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.width, crop.height);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  return { dataUrl, base64: dataUrl.replace(/^data:image\/jpeg;base64,/, '') };
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, ZoomIn } from 'lucide-react';
import {
  approximateBytes, clampOffset, coverScale, renderCrop, sourceRect, type Offset,
} from '@/lib/image-crop';

/**
 * Choosing which part of an image to keep (SPC-17).
 *
 * Charley uploaded a 2:3 poster for a room whose card renders a wide banner,
 * and said he was happy to crop it — the point being that he should not have
 * to do it in another application first. Centre-cropping a portrait poster into
 * a landscape frame takes the middle of it, which for that poster is a
 * bookshelf and no title.
 *
 * The interaction is the one everybody already knows from setting a profile
 * picture: a fixed window, the image behind it, drag to move and a slider to
 * zoom. Deliberately not free-form corner handles — those ask somebody to
 * choose an aspect ratio, which is the app's decision and not theirs, and they
 * are miserable on a touchscreen.
 *
 * The frame is shown at whatever size fits the dialog, but the crop is read
 * back in the *original's* pixels — so what is stored is as sharp as what was
 * uploaded, not as sharp as the preview.
 */
export function ImageCropper({
  file, aspect, maxLongEdge = 1600, onCancel, onDone,
}: {
  file: File;
  /** Width ÷ height of the frame. Matches where the image will be shown. */
  aspect: number;
  maxLongEdge?: number;
  onCancel: () => void;
  onDone: (result: { dataUrl: string; mimeType: string; bytes: number }) => Promise<void> | void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const drag = useRef<{ x: number; y: number; from: Offset } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    // Revoked when the dialog closes: an object URL held past its use is a
    // reference to the whole file kept alive in memory.
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // The frame is whatever width the dialog gives it; its height follows the
  // aspect. Measured rather than assumed so this works at any dialog size.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      setFrame({ width, height: Math.round(width / aspect) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [aspect, src]);

  const base = natural && frame.width ? coverScale(natural, frame) : 1;
  const scale = base * zoom;

  // Start centred on the middle of the image, which is the best guess anybody
  // can make before they have looked at it.
  const centre = useCallback(() => {
    if (!natural || !frame.width) return;
    const s = coverScale(natural, frame);
    setOffset(
      clampOffset(
        {
          x: (frame.width - natural.width * s) / 2,
          y: (frame.height - natural.height * s) / 2,
        },
        natural, frame, s,
      ),
    );
    setZoom(1);
  }, [natural, frame]);

  useEffect(() => {
    centre();
  }, [centre]);

  function onPointerDown(e: React.PointerEvent) {
    if (!natural) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, from: offset };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !natural) return;
    setOffset(
      clampOffset(
        { x: d.from.x + (e.clientX - d.x), y: d.from.y + (e.clientY - d.y) },
        natural, frame, scale,
      ),
    );
  }

  function onPointerUp(e: React.PointerEvent) {
    drag.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }

  function changeZoom(next: number) {
    if (!natural) return;
    setZoom(next);
    // Re-clamp against the new scale, or zooming out from a corner would leave
    // the frame hanging off the edge of the image.
    setOffset((current) => clampOffset(current, natural, frame, base * next));
  }

  async function confirm() {
    const img = imageRef.current;
    if (!img || !natural) return;

    /**
     * Refuse a frame that never measured.
     *
     * Found the hard way, in a browser whose viewport was reporting 0×0: the
     * frame measured zero, `sourceRect` came out zero wide, and `outputSize`'s
     * "never round to nothing" clamp turned that into a **1×1 image**, uploaded
     * without complaint. A viewport of zero is an odd state, but the failure it
     * produced is the point — the worst possible outcome for something whose
     * whole job is producing a picture is producing a broken one silently.
     *
     * Any measurement that cannot yield a real crop stops here and says so.
     */
    if (!frame.width || !frame.height) {
      setProblem('The cropper could not measure itself. Close this and try again.');
      return;
    }

    setBusy(true);
    setProblem('');
    try {
      const crop = sourceRect(natural, frame, scale, offset);
      const { dataUrl, mimeType } = renderCrop(img, crop, { maxLongEdge });
      await onDone({ dataUrl, mimeType, bytes: approximateBytes(dataUrl) });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work');
      setBusy(false);
    }
  }

  // Rendered onto the body, not where the uploader happens to sit.
  //
  // `position: fixed` escapes the page's layout but not its *visibility*: an
  // element inside a `display: none` ancestor is not rendered at all, however
  // it is positioned — and the uploader lives inside a room's editor panel,
  // which is collapsed most of the time. This was not what caused the 1×1
  // above; that was a zero viewport. It is here because a modal belongs on the
  // body regardless, clear of a parent's visibility, `overflow` and stacking
  // context.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Crop the image"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-gray-900">Crop the image</h2>
        <p className="mt-1 text-sm text-gray-500">
          Drag to move it, and zoom to fill the frame. This is the shape it will appear in.
        </p>

        {problem && <p className="mt-3 text-sm text-red-600">{problem}</p>}

        <div
          ref={frameRef}
          style={{ height: frame.height || undefined }}
          className="relative mt-4 w-full cursor-grab overflow-hidden rounded-xl bg-gray-100 active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imageRef}
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget;
                setNatural({ width: el.naturalWidth, height: el.naturalHeight });
              }}
              style={
                natural
                  ? {
                      position: 'absolute',
                      left: offset.x,
                      top: offset.y,
                      width: natural.width * scale,
                      height: natural.height * scale,
                      maxWidth: 'none',
                    }
                  : { visibility: 'hidden' }
              }
            />
          )}
        </div>

        <label className="mt-4 flex items-center gap-3">
          <ZoomIn className="h-4 w-4 shrink-0 text-gray-400" />
          <span className="sr-only">Zoom</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => changeZoom(Number(e.target.value))}
            className="w-full"
          />
        </label>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={centre}
            disabled={busy}
            className="mr-auto text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy || !natural}
            className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? 'Uploading…' : 'Use this'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

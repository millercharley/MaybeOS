'use client';

import { focusOffsetPct, focusWindowPct } from '@/lib/image-crop';

/**
 * Which part of the banner the Handbook index shows as a square (BEL-12).
 *
 * Charley: "Enable the Admin to decide which portion of the banner image gets
 * cropped." A 3:1 banner in a 1:1 frame is a narrow vertical slice of it, and
 * the middle is rarely the subject — a microphone on the left, a room on the
 * right.
 *
 * A slider rather than a drag handle. There is exactly one number to choose
 * (the height is always used in full), a slider says that without being told,
 * and it works with a keyboard and on a phone where dragging a marquee inside
 * a 3:1 strip is fiddly.
 *
 * Both halves are shown live: the banner with the square marked on it, so the
 * admin can see *what they are choosing from*, and the square itself at the
 * size it renders in the index, so they can see *what they will get*.
 */
export function CoverFocus({
  imageUrl,
  value,
  onChange,
  aspect = 3,
  label = 'Thumbnail',
  hint = 'The square shown beside this article in the Handbook list. Slide to choose which part of the banner it takes.',
  preview = 'square',
}: {
  imageUrl: string;
  value: number;
  onChange: (next: number) => void;
  /**
   * The shape of the source image the square is taken *from* (SPC-19). A
   * Handbook banner is 3:1; a room photo is 3:2, so the marquee covering "one
   * square's worth" is a different fraction of the strip.
   */
  aspect?: number;
  label?: string;
  hint?: string;
  /** Rooms show their photo in a circle on the booking screen. */
  preview?: 'square' | 'circle';
}) {
  // How wide one square is as a fraction of the strip, and where it sits — so
  // the marquee marks exactly what the crop will take, at any source shape.
  const windowPct = focusWindowPct(aspect);
  const focus = Math.min(100, Math.max(0, value));

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-800">{label}</p>
          <p className="mt-0.5 text-xs text-gray-500">{hint}</p>
        </div>
        {/* The real thing, at the size it actually renders. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="How the thumbnail will look"
          style={{ objectPosition: `${focus}% 50%` }}
          className={`h-11 w-11 shrink-0 object-cover ring-1 ring-gray-200 ${
            preview === 'circle' ? 'rounded-full' : 'rounded-lg'
          }`}
        />
      </div>

      {/*
        The image with the chosen square marked on it, at the shape it was
        cropped to — so the marquee's width is exactly the slice the square
        will take, and it slides between the two edges rather than off them.
      */}
      <div className="relative mt-3 overflow-hidden rounded-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          style={{ aspectRatio: String(aspect) }}
          className="w-full object-cover"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 rounded-md ring-2 ring-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          style={{ width: `${windowPct}%`, left: `${focusOffsetPct(focus, aspect)}%` }}
        />
      </div>

      <label className="mt-3 block">
        <span className="sr-only">Thumbnail position across the banner</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={focus}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-brand-600"
        />
      </label>
      <div className="flex justify-between text-xs text-gray-400">
        <span>Left</span>
        <span>Center</span>
        <span>Right</span>
      </div>
    </div>
  );
}

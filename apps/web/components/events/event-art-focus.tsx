'use client';

import { bandTopPct, focusStyle } from '@/lib/image-focus';

/**
 * Which band of the picture the card keeps (EVT-43).
 *
 * Charley, looking at the dashboard: "Ask the user to set the focus on the
 * image so we don't see heads cut off like this." JG Shadid's card showed him
 * from the shoulders down, because `object-fit: cover` takes the middle and
 * the middle of a photograph of a person is their chest.
 *
 * A slider, like the Handbook's (BEL-12), and vertical for the same reason
 * that one is horizontal: it moves along the axis the crop actually eats. One
 * number, so a slider says what there is to choose without being told, and it
 * works with a keyboard and on a phone.
 *
 * **Both halves live.** The whole picture with the kept band marked on it, so
 * the host can see what they are choosing *from*, and beside it the card's own
 * frame, so they can see what they will *get*. A preview that is not the real
 * shape is how somebody sets a focus that looks right here and wrong there.
 */
export function EventArtFocus({
  imageUrl,
  value,
  onChange,
}: {
  imageUrl: string;
  value: number;
  onChange: (next: number) => void;
}) {
  /*
    How tall the kept band is, as a percentage of a portrait source.

    Not arithmetic from the real image: its shape is not known until it loads,
    and a marquee that resized as the picture arrived would be worse than one
    that is honestly approximate. The card is roughly 3:1 at its widest and the
    pictures that suffer are portrait, so a third is the right order — enough
    to show that a band is being taken and which one.
  */
  const BAND = 34;
  const top = bandTopPct(value, BAND);

  return (
    <div className="mt-3 rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-medium text-gray-800">Which part to show</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Cards and the dashboard crop a picture to a wide strip. Slide to keep the part
            that matters — faces are usually near the top.
          </p>
        </div>

        {/* What they will actually get, in the card's own shape. */}
        <div className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            style={focusStyle(value)}
            className="h-20 w-56 rounded-lg border border-gray-200 bg-gray-50 object-cover"
          />
          <p className="mt-1 text-center text-[11px] text-gray-400">How the card will look</p>
        </div>
      </div>

      {/* What they are choosing from, with the kept band marked on it. */}
      <div className="relative mt-3 overflow-hidden rounded-lg bg-gray-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" className="max-h-56 w-full object-contain" />
        <div
          aria-hidden="true"
          style={{ top: `${top}%`, height: `${BAND}%` }}
          className="pointer-events-none absolute inset-x-0 border-y-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
        />
      </div>

      <label className="mt-3 block">
        <span className="sr-only">How far down the picture to centre on</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full"
        />
      </label>
      <div className="flex justify-between text-[11px] text-gray-400">
        <span>Top</span>
        <span>Bottom</span>
      </div>
    </div>
  );
}

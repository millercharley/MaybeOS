'use client';

import { useState } from 'react';
import { Smile, X } from 'lucide-react';
import { CHANNEL_EMOJI } from '@/lib/emoji';

/**
 * Pick one emoji for a channel (CMN-11).
 *
 * A button showing the current choice, a grid of the common ones, and a text
 * field for anything else — because a fixed list is a guess about what a
 * co-op's channels are about, and being unable to use the right emoji is
 * worse than scrolling past thirty.
 *
 * `maxLength` is generous on purpose: a single emoji is often several code
 * points (a flag is two, a family is seven), and a limit of 2 would refuse
 * exactly the ones people are proudest of. The API validates the shape.
 */
export function EmojiPicker({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (emoji: string) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <button
          type="button"
          id={id}
          onClick={() => setOpen(!open)}
          aria-label={value ? `Channel emoji: ${value}. Change it` : 'Pick a channel emoji'}
          aria-expanded={open}
          className="flex h-10 w-12 items-center justify-center rounded-lg border border-gray-200 text-lg hover:bg-gray-50"
        >
          {value || <Smile className="h-4 w-4 text-gray-400" aria-hidden="true" />}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Remove the emoji"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 top-12 z-30 w-64 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
          <div className="grid grid-cols-6 gap-1">
            {CHANNEL_EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onChange(emoji);
                  setOpen(false);
                }}
                className={`rounded p-1 text-lg hover:bg-gray-100 ${
                  value === emoji ? 'bg-brand-50' : ''
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
          <label className="mt-2 block border-t border-gray-100 pt-2">
            <span className="sr-only">Or type any emoji</span>
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              maxLength={24}
              placeholder="Or paste another"
              className="w-full rounded-md border border-gray-200 px-2 py-1 text-sm"
            />
          </label>
        </div>
      )}
    </div>
  );
}

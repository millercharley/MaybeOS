'use client';

import { useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { COMPOSER_EMOJI } from '@/lib/emoji';
import {
  REACTIONS,
  looksLikeEmoji,
  reactionLabel,
  toggled,
  type ReactionGroup,
} from '@/lib/reactions';

/**
 * The emoji under a message (CMN-17).
 *
 * Charley: "Make sure people can leave an emoji reaction on any message."
 *
 * One component for every kind of message — a DM, a message in a group, a
 * reply in the Commons — because they are the same gesture and a second
 * implementation is a second set of pills that look almost but not quite the
 * same.
 *
 * Pressing is **optimistic**. A reaction that takes a round trip to appear
 * feels broken, and this is the one thing in the product somebody does three
 * times in a row. The server's answer replaces the guess when it lands; if it
 * fails, the guess is rolled back and nothing else is said — a failed emoji is
 * not worth an error banner.
 */
export function ReactionBar({
  reactions,
  onToggle,
  align = 'left',
}: {
  reactions: ReactionGroup[];
  /** Returns the server's list, or null if it could not be saved. */
  onToggle: (emoji: string) => Promise<ReactionGroup[] | null>;
  align?: 'left' | 'right';
}) {
  const [shown, setShown] = useState<ReactionGroup[] | null>(null);
  const [picking, setPicking] = useState(false);
  /** Anything not on the grid, typed in (CMN-21). */
  const [typed, setTyped] = useState('');
  const groups = shown ?? reactions;

  /*
    The six offered first, then the rest of the common ones, with no
    duplicates (CMN-21). `COMPOSER_EMOJI` already contains most of the six, so
    concatenating without this would show 👍 twice.
  */
  const offered = [...new Set([...REACTIONS, ...COMPOSER_EMOJI])];

  async function press(emoji: string) {
    const guess = toggled(groups, emoji);
    setShown(guess);
    setPicking(false);
    setTyped('');

    const settled = await onToggle(emoji);
    setShown(settled ?? reactions);
  }

  return (
    <div
      className={`mt-1 flex flex-wrap items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}
    >
      {groups.map((g) => (
        <button
          key={g.emoji}
          type="button"
          onClick={() => press(g.emoji)}
          title={reactionLabel(g)}
          aria-label={`${g.emoji} — ${reactionLabel(g)}`}
          aria-pressed={g.mine}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
            g.mine
              ? 'border-brand-300 bg-brand-50 text-brand-700'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          <span aria-hidden="true">{g.emoji}</span>
          <span className="tabular-nums">{g.count}</span>
        </button>
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => setPicking((p) => !p)}
          aria-label="Add a reaction"
          aria-expanded={picking}
          className="inline-flex items-center rounded-full border border-transparent p-1 text-gray-400 hover:border-gray-200 hover:bg-white hover:text-gray-700"
        >
          <SmilePlus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        {picking && (
          <>
            {/* Anywhere else closes it. Without this the only way out is to
                choose something, which is not what somebody who opened it by
                accident wants. */}
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setPicking(false)}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div
              className={`absolute bottom-full z-20 mb-1 w-56 rounded-xl border border-gray-200 bg-white p-2 shadow-lg ${
                align === 'right' ? 'right-0' : 'left-0'
              }`}
            >
              {/*
                A grid rather than a row (CMN-21). Charley: "offer an emoji
                picker so people can get creative." The six that group best
                come first and the rest of the common ones follow, because a
                picker that buries 👍 makes the ordinary case worse to make
                the rare one possible.
              */}
              <div className="grid grid-cols-6 gap-0.5">
                {offered.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => press(emoji)}
                    aria-label={`React with ${emoji}`}
                    className="rounded-lg px-1.5 py-1 text-base leading-none hover:bg-gray-100"
                  >
                    <span aria-hidden="true">{emoji}</span>
                  </button>
                ))}
              </div>

              {/*
                And anything at all (CMN-21). No emoji keyboard is shipped:
                every device already has one behind its own shortcut, and a
                complete set is a data file and a dependency. This is the same
                bargain the channel emoji picker struck — a grid for the
                common ones, a field for the rest.
              */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const chosen = typed.trim();
                  // Answered here rather than by a silent rollback: somebody
                  // who typed a word meant something by it (CMN-21).
                  if (looksLikeEmoji(chosen)) press(chosen);
                }}
                className="mt-2 flex items-center gap-1 border-t border-gray-100 pt-2"
              >
                <label htmlFor="reaction-any" className="sr-only">
                  Or use any emoji
                </label>
                <input
                  id="reaction-any"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="Any emoji…"
                  maxLength={24}
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1 text-sm focus:border-brand-400 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!looksLikeEmoji(typed)}
                  className="rounded-lg bg-gray-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
                >
                  Add
                </button>
              </form>
              {typed.trim() && !looksLikeEmoji(typed) && (
                <p className="mt-1 text-[11px] text-gray-500">
                  That needs to be an emoji — your keyboard&rsquo;s own picker has them all.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

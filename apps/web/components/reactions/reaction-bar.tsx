'use client';

import { useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { REACTIONS, reactionLabel, toggled, type ReactionGroup } from '@/lib/reactions';

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
  const groups = shown ?? reactions;

  async function press(emoji: string) {
    const guess = toggled(groups, emoji);
    setShown(guess);
    setPicking(false);

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
              className={`absolute bottom-full z-20 mb-1 flex gap-0.5 rounded-full border border-gray-200 bg-white p-1 shadow-lg ${
                align === 'right' ? 'right-0' : 'left-0'
              }`}
            >
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => press(emoji)}
                  aria-label={`React with ${emoji}`}
                  className="rounded-full px-1.5 py-0.5 text-base leading-none hover:bg-gray-100"
                >
                  <span aria-hidden="true">{emoji}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

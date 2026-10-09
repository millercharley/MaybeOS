'use client';

import { useState, type MouseEvent } from 'react';
import { SmilePlus } from 'lucide-react';
import { popoverPosition } from '@/lib/popover';
import { EmojiLibraryPicker } from '@/components/reactions/emoji-library-picker';
import { reactionLabel, toggled, type ReactionGroup } from '@/lib/reactions';

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
  /**
   * Where the panel sits, in viewport coordinates (CMN-22).
   *
   * Not `absolute` inside the bar. A post card and the channel feed both
   * scroll, and an absolutely-positioned child is clipped by either — the
   * picker opened upward from a button near the top of a card and had its
   * first rows cut off. The row menu learned this already (UI-02); this is
   * the same answer.
   */
  const [picking, setPicking] = useState<{ top: number; left: number } | null>(null);
  const groups = shown ?? reactions;

  /**
   * The picker's own box — `w-72` and `max-h-80` in its markup.
   *
   * Named here because the placement has to know the size before the panel
   * exists to be measured.
   */
  const PANEL = { width: 288, height: 320 };

  function openPicker(event: MouseEvent<HTMLButtonElement>) {
    if (picking) {
      setPicking(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setPicking(
      popoverPosition(
        rect,
        { width: window.innerWidth, height: window.innerHeight },
        PANEL,
        align,
      ),
    );
  }

  async function press(emoji: string) {
    const guess = toggled(groups, emoji);
    setShown(guess);
    setPicking(null);

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
          onClick={openPicker}
          aria-label="Add a reaction"
          aria-expanded={picking !== null}
          className="inline-flex items-center rounded-full border border-transparent p-1 text-gray-400 hover:border-gray-200 hover:bg-white hover:text-gray-700"
        >
          <SmilePlus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        {picking !== null && (
          <>
            {/* Anywhere else closes it. Without this the only way out is to
                choose something, which is not what somebody who opened it by
                accident wants. */}
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setPicking(null)}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div
              style={{ top: picking.top, left: picking.left }}
              className="fixed z-50 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
            >
              <EmojiLibraryPicker onPick={press} onDismiss={() => setPicking(null)} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { EMOJI_LIBRARY, searchEmoji, takesTone, type EmojiEntry } from '@/lib/emoji-library';
import { looksLikeEmoji } from '@/lib/reactions';
import {
  SKIN_TONES,
  applyTone,
  readTone,
  rememberTone,
  type SkinToneId,
} from '@/lib/skin-tone';

/**
 * Pick any emoji, in your own skin (CMN-24).
 *
 * Charley: "I don't like that people of color have to give a white person's
 * thumbs up... the library picker would also allow people to easily search
 * and pick any emoji."
 *
 * **The tone is chosen once and remembered.** Asking somebody to pick their
 * own skin every single time they agree with something would be its own kind
 * of insult. It sits at the top where it can be changed, and is applied to
 * everything in the grid that takes one, so the whole picker is already in
 * your own hands before you choose anything.
 *
 * The field at the bottom stays: the library is a few hundred rather than all
 * of them, and anything outside it can still be pasted from the keyboard
 * every device already has.
 */
export function EmojiLibraryPicker({
  onPick,
  onDismiss,
}: {
  onPick: (emoji: string) => void;
  onDismiss: () => void;
}) {
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState('');
  const [tone, setTone] = useState<SkinToneId>('default');

  // Read after mount: localStorage does not exist while this renders on the
  // server, and a tone that flickered in on hydration would be worse than one
  // that arrives a frame late.
  useEffect(() => setTone(readTone()), []);

  function choose(tone: SkinToneId) {
    setTone(tone);
    rememberTone(tone);
  }

  /** What is shown: a search, or the whole library in its groups. */
  const results = useMemo(() => (query.trim() ? searchEmoji(query) : null), [query]);

  const render = (entry: EmojiEntry) => {
    const shown = takesTone(entry.emoji) ? applyTone(entry.emoji, tone) : entry.emoji;
    return (
      <button
        key={entry.emoji}
        type="button"
        onClick={() => onPick(shown)}
        title={entry.name}
        aria-label={`React with ${entry.name}`}
        className="rounded-lg px-1 py-1 text-lg leading-none hover:bg-gray-100"
      >
        <span aria-hidden="true">{shown}</span>
      </button>
    );
  };

  return (
    <div className="flex max-h-80 w-72 flex-col">
      <div className="border-b border-gray-100 p-2">
        <label htmlFor="emoji-search" className="sr-only">
          Search emoji
        </label>
        <input
          id="emoji-search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onDismiss();
          }}
          placeholder="Search…"
          className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
        />

        {/*
          The tone, chosen once (CMN-24). At the top rather than buried,
          because for the person this was built for it is the first decision,
          not an afterthought.
        */}
        <div className="mt-2 flex items-center gap-1">
          <span className="mr-1 text-[11px] text-gray-500">Skin tone</span>
          {SKIN_TONES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => choose(t.id)}
              aria-label={t.label}
              aria-pressed={tone === t.id}
              title={t.label}
              className={`rounded-md px-1 text-base leading-none ${
                tone === t.id ? 'bg-brand-100 ring-1 ring-brand-400' : 'hover:bg-gray-100'
              }`}
            >
              <span aria-hidden="true">{applyTone('✋', t.id)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {results ? (
          results.length > 0 ? (
            <div className="grid grid-cols-8 gap-0.5">{results.map(render)}</div>
          ) : (
            <p className="px-1 py-6 text-center text-xs text-gray-500">
              Nothing matches “{query.trim()}”. You can still paste any emoji below.
            </p>
          )
        ) : (
          EMOJI_LIBRARY.map((group) => (
            <div key={group.name} className="mb-2">
              <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                {group.name}
              </p>
              <div className="grid grid-cols-8 gap-0.5">{group.emoji.map(render)}</div>
            </div>
          ))
        )}
      </div>

      {/* Anything the library does not hold. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const chosen = typed.trim();
          if (looksLikeEmoji(chosen)) onPick(chosen);
        }}
        className="border-t border-gray-100 p-2"
      >
        <div className="flex items-center gap-1">
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
        </div>

        {/*
          Said here, now, rather than by accepting the text and rolling the
          reaction back when the server refuses it. A disabled button on its
          own only tells somebody that nothing is happening.
        */}
        {typed.trim() !== '' && !looksLikeEmoji(typed) && (
          <p className="mt-1 text-[11px] text-gray-500">That needs to be an emoji.</p>
        )}
      </form>
    </div>
  );
}

import { badgeDescription, badgeLabel, type UnreadKey } from '@/lib/unread';

/**
 * The red bubble (CMN-14).
 *
 * Charley asked for red, and red it is — not the brand colour, which is the
 * sidebar's own active-row background (`bg-brand-600`): a brand-red pill on a
 * brand-red row is an invisible badge, which is the one thing a badge must
 * never be. `bg-danger` against the dark ink sidebar is the contrast that
 * makes it read as an alert rather than as decoration.
 *
 * The numeral is hidden from screen readers and replaced with a sentence.
 * Announced as written, a bare `3` becomes "Messages 3", which could be a
 * heading number, a count of channels, or nothing at all.
 */
export function UnreadBadge({
  count,
  what,
  onActiveRow = false,
}: {
  count: number;
  what: UnreadKey;
  /**
   * Whether this sits on the selected row, which is already brand-red. The
   * badge goes to paper-on-ink there, because red on red is a smudge.
   */
  onActiveRow?: boolean;
}) {
  if (count <= 0) return null;

  return (
    <span
      className={[
        'ml-auto inline-flex min-w-[1.25rem] shrink-0 items-center justify-center',
        'rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none tabular-nums',
        onActiveRow ? 'bg-white text-brand-700' : 'bg-[var(--danger)] text-white',
      ].join(' ')}
    >
      <span aria-hidden="true">{badgeLabel(count)}</span>
      <span className="sr-only">{badgeDescription(count, what)}</span>
    </span>
  );
}

/**
 * Somebody's face, or their initial (CMN-23).
 *
 * Charley: "the avatar images are not loading in the Commons." They were
 * never asked for. Every circle there rendered the first letter of a name and
 * nothing else, while the same person's photograph showed on their profile —
 * so it read as a loading failure rather than as a thing that had not been
 * built.
 *
 * One component, because the pattern was already written out by hand in the
 * RSVP faces, the member card and the sidebar, and a sixth copy is how they
 * start disagreeing about the fallback.
 */
const SIZES = {
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
} as const;

export function Avatar({
  name,
  avatarUrl,
  size = 'sm',
  className = '',
}: {
  name?: string | null;
  avatarUrl?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const box = `${SIZES[size]} shrink-0 rounded-full object-cover ${className}`;

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatarUrl} alt="" className={`${box} bg-brand-100`} />
    );
  }

  /*
    The initial, uppercased wherever it came from.

    A name typed in lower case is common — "andrew kang bartlett" — and a
    lower-case letter alone in a circle reads as a glyph rather than as a
    person.
  */
  const initial = (name ?? '').trim().charAt(0).toUpperCase() || '?';

  return (
    <span
      aria-hidden="true"
      className={`${box} flex items-center justify-center bg-brand-100 font-medium text-brand-700`}
    >
      {initial}
    </span>
  );
}

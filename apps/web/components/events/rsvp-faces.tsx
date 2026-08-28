'use client';

/**
 * Who else is going (delight #3).
 *
 * People decide whether to go based on who else is going, and a row of faces
 * answers that faster than a number does.
 *
 * **Never rendered on a public event page.** The API only sends these on
 * member-facing lists, and the reason is worth keeping in view: an event link
 * may be public so strangers can RSVP, but the guest list is not — a public
 * page showing faces would tell anyone with the URL who belongs to this
 * co-op.
 */
export function RsvpFaces({
  faces,
  total,
  size = 'sm',
}: {
  faces: Array<{ id: string; name: string | null; avatarUrl?: string | null }>;
  total: number;
  size?: 'sm' | 'md';
}) {
  if (total === 0) return null;

  const px = size === 'md' ? 'h-8 w-8 text-xs' : 'h-7 w-7 text-[11px]';
  const shown = faces.slice(0, 4);
  // Faces we have, versus people who are going. Guest RSVPs have no account
  // and no face, so these two numbers genuinely differ and the count has to
  // come from the total rather than from the row.
  const rest = total - shown.length;

  return (
    <div className="flex items-center gap-2">
      {shown.length > 0 && (
        <div className="flex -space-x-1.5">
          {shown.map((p) =>
            p.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={p.id}
                src={p.avatarUrl}
                alt={p.name ?? ''}
                title={p.name ?? undefined}
                className={`${px} rounded-full object-cover ring-2 ring-white`}
              />
            ) : (
              <div
                key={p.id}
                title={p.name ?? undefined}
                className={`${px} flex items-center justify-center rounded-full bg-gray-100 font-semibold text-gray-600 ring-2 ring-white`}
              >
                {(p.name ?? '?').charAt(0).toUpperCase()}
              </div>
            ),
          )}
        </div>
      )}
      <span className="text-xs text-gray-500">
        {rest > 0 && shown.length > 0
          ? `+${rest} going`
          : `${total} ${total === 1 ? 'person' : 'people'} going`}
      </span>
    </div>
  );
}

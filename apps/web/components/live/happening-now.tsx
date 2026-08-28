'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, DoorOpen, Users } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api';
import type { HappeningNow as HappeningNowData } from '@/lib/api';

/** Faces, overlapped, with the overflow counted rather than hidden. */
function Faces({
  people,
  total,
}: {
  people: Array<{ id: string; name: string | null; avatarUrl?: string | null }>;
  total: number;
}) {
  const shown = people.slice(0, 6);
  const rest = total - shown.length;

  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((p) =>
          p.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={p.id}
              src={p.avatarUrl}
              alt={p.name ?? ''}
              title={p.name ?? undefined}
              className="h-8 w-8 rounded-full object-cover ring-2 ring-white"
            />
          ) : (
            <div
              key={p.id}
              title={p.name ?? undefined}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700 ring-2 ring-white"
            >
              {(p.name ?? '?').charAt(0).toUpperCase()}
            </div>
          ),
        )}
      </div>
      {rest > 0 && <span className="ml-2 text-sm text-gray-500">+{rest}</span>}
    </div>
  );
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * What is going on in the building, right now (delight #2).
 *
 * For a physical space this answers the question somebody actually has
 * standing in the doorway — *is anyone here?* — which is a different question
 * from everything else on a dashboard, all of which people only ask sitting
 * down.
 *
 * **Renders nothing when nothing is happening.** An empty "Happening now"
 * panel with three zeroes in it is worse than no panel: it makes a quiet
 * Tuesday afternoon look like a failure, every Tuesday afternoon, on the
 * first screen everybody sees.
 *
 * Refreshes every 60 seconds and says when it was true, rather than
 * implying it is live. A strip that claims to be live and is four minutes
 * stale is how somebody walks to an empty room.
 */
export function HappeningNow({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<HappeningNowData | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !token) return;
    try {
      setData(await api.dashboard.happeningNow(orgId, token));
    } catch {
      // A quiet failure: this is an enhancement on somebody's home screen,
      // and an error banner where the panel would be is worse than nothing.
      setData(null);
    }
  }, [orgId, token]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!data) return null;

  const nothing =
    data.checkedInCount === 0 && data.rooms.length === 0 && data.startingSoon.length === 0;
  if (nothing) return null;

  return (
    <section
      aria-label="Happening now"
      className="rounded-2xl border border-gray-200 bg-white p-5"
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-gray-900">
          <span className="relative flex h-2 w-2" aria-hidden>
            {/* One quiet pulse, not a flashing dot. A home screen that
                blinks is a home screen people stop looking at. */}
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          Happening now
        </h2>
        <span className="text-xs text-gray-400">as of {time(data.asOf)}</span>
      </div>

      {/* Auto-fit rather than a fixed three columns: most of the time only
          one or two of these have anything to say, and a fixed grid leaves a
          hole where the empty one would be. */}
      <div className="grid gap-5 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
        {data.checkedInCount > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
              <Users className="h-3.5 w-3.5" />
              {data.checkedInCount} here
            </p>
            <Faces
              people={data.checkedIn.map((c) => c.user)}
              total={data.checkedInCount}
            />
            <p className="mt-2 truncate text-sm text-gray-600">
              {data.checkedIn[0]?.eventTitle}
            </p>
          </div>
        )}

        {data.rooms.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
              <DoorOpen className="h-3.5 w-3.5" />
              {data.rooms.length === 1 ? 'One room in use' : `${data.rooms.length} rooms in use`}
            </p>
            <ul className="space-y-1.5 text-sm">
              {data.rooms.slice(0, 3).map((r) => (
                <li key={r.id}>
                  {/* The name truncates; the time never does. A room called
                      "The Long Room Downstairs" losing its last word costs
                      nothing, and "until 4:0…" costs the whole line. */}
                  <p className="truncate font-medium text-gray-800">{r.roomName}</p>
                  <p className="text-xs text-gray-500">until {time(r.until)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.startingSoon.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
              <CalendarClock className="h-3.5 w-3.5" />
              Starting soon
            </p>
            <ul className="space-y-1.5 text-sm">
              {data.startingSoon.slice(0, 3).map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/portal/${orgSlug}/events/${e.slug}`}
                    className="block truncate font-medium text-gray-800 hover:text-brand-700"
                  >
                    {e.title}
                  </Link>
                  {/* The when is the point of this section, so it gets its own
                      line and is never clipped. */}
                  <p className="text-xs text-gray-500">
                    {time(e.startTime)}
                    {e.where ? ` · ${e.where}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

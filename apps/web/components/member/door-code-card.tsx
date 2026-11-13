'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DoorOpen, ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/use-api';

/**
 * The door code, on the first screen a member sees (DOR-07).
 *
 * Charley, 2026-11-13: members could not find it. It was never hidden — it
 * has always been at the top of My Profile — but on a phone My Profile is
 * inside a collapsed section inside a drawer behind an icon. Somebody
 * standing in the cold outside the side door is not going to find it there.
 *
 * **Shown on a tap, not on load.** The dashboard is what opens when the app
 * opens, in a pocket, on a bus, over somebody's shoulder; a five-letter key
 * to a building should not be the thing that is on screen by default.
 * Charley chose this over printing it outright. One tap is still three fewer
 * than the drawer, and the tap is the member asking.
 *
 * **Nothing at all when there is no code.** A co-op with no door, a guest, a
 * cancelled membership — the API answers null for each, and this draws
 * nothing. A door control over an empty space is a question, not an answer,
 * and it would appear on every co-op on MaybeOS that has never had a door.
 */
export function DoorCodeCard({ orgSlug }: { orgSlug: string }) {
  const { data } = useApi((token, orgId) => api.door.myPin(orgId, token), []);
  const [shown, setShown] = useState(false);

  const pin = data?.doorPin ?? null;
  if (!pin) return null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <DoorOpen className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
        <h2 className="flex-1 text-sm font-semibold text-gray-900">Door code</h2>

        {!shown && (
          <button type="button" onClick={() => setShown(true)} className="btn-secondary text-sm">
            Show
          </button>
        )}
      </div>

      {shown && (
        <div className="mt-3">
          {/* The same shape as the profile's (DOR-01): capitals in the
              display serif, letter-spaced, so a code can carry an I and an L
              without being read as the other one. */}
          <p className="font-display text-3xl uppercase tracking-[0.3em] text-gray-900">{pin}</p>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {/*
              Where to use it (DOR-07).

              MaybeOS issued the code and then said nothing about the door it
              opens — the link lived on a sticker by the handle. Absent unless
              the co-op has actually set a door page up, because a dead link
              at the door is worse than no link at all.

              A new tab: the door page is somebody else's application and takes
              a moment to answer, and a member who taps it should still have
              MaybeOS behind them when they come back.
            */}
            {data?.doorUrl && (
              <a
                href={data.doorUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
              >
                Open the door
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}

            <Link
              href={`/member/${orgSlug}/profile`}
              className="font-medium text-gray-500 hover:underline"
            >
              My Profile
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

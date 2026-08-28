'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, Clock } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, OutstandingReading } from '@/lib/api';
import { timeUntil } from '@/lib/relative-time';

/**
 * What you still owe, on every page rather than one (PRD §6.2).
 *
 * A member inside their grace period needs to know before the day it runs
 * out, and a member already blocked needs to know *before* they type a
 * paragraph into a composer and press Post — being refused after writing
 * something is the version of this that makes people feel tricked.
 *
 * So it sits in the portal shell. Reading is never gated, so the banner is
 * the only thing standing between a member and the whole community — it is
 * information, not a wall.
 */
export function RequiredReadingBanner() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const pathname = usePathname();
  const [outstanding, setOutstanding] = useState<OutstandingReading | null>(null);

  useEffect(() => {
    if (!org || !token) return;
    api.belonging
      .outstandingReading(org.id, token)
      .then(setOutstanding)
      // A co-op with the tool off answers with nothing owed; a network blip
      // should not put an error banner across an unrelated page.
      .catch(() => setOutstanding(null));
  }, [org, token, pathname]);

  if (!outstanding || !org) return null;

  const blocking = outstanding.blocking.length;
  const inGrace = outstanding.inGrace.length;
  if (blocking === 0 && inGrace === 0) return null;

  // Already reading the thing, or already walking through them. Repeating
  // the instruction on the page that carries it out is nagging.
  if (pathname.startsWith(`/portal/${org.slug}/welcome`)) return null;

  const href = `/portal/${org.slug}/welcome/start`;

  if (blocking > 0) {
    return (
      <Link
        href={href}
        className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-8 py-3 text-sm text-amber-900 hover:bg-amber-100"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          <b>
            {blocking === 1 ? 'There is one thing' : `There are ${blocking} things`} to read and
            agree to
          </b>{' '}
          before you can post, comment, vote or RSVP here. Reading stays open either way.
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="flex items-center gap-2 border-b border-gray-200 bg-white px-8 py-3 text-sm text-gray-700 hover:bg-gray-50"
    >
      <Clock className="h-4 w-4 shrink-0 text-gray-400" />
      <span>
        {inGrace === 1 ? 'One thing' : `${inGrace} things`} here to read and agree to. You can carry
        on as normal until <b>{outstanding.graceEndsAt ? timeUntil(outstanding.graceEndsAt) : 'soon'}</b>.
      </span>
    </Link>
  );
}

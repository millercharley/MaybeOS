'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Users } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api';
import type { HostEventSummary } from '@/lib/api';
import { money } from '@/lib/fees';

/**
 * How it went, for the person who hosted it (delight #5).
 *
 * Three lines of money rather than one, because a host who only sees what
 * they are owed cannot tell whether a small number means few tickets or a
 * large share to the co-op. Gross, the co-op's share, what is left — and the
 * figures come from the payout row, so what a host reads here is what the
 * co-op will actually pay rather than a second calculation that can disagree
 * with it.
 *
 * Attendance says **which** number it is. A door nobody scanned is not an
 * event nobody came to, and a host who reads "0 attended" about a full room
 * will not trust the next number either.
 */
export function EventSummary({ orgId, eventId }: { orgId: string; eventId: string }) {
  const token = useAuthStore((s) => s.token);
  const [summary, setSummary] = useState<HostEventSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId || !token) return;
    api
      .eventSummary(orgId, eventId, token)
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [orgId, eventId, token]);

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
      </div>
    );
  }

  // Nothing before the event has happened: a "summary" of a future event is a
  // forecast, and hosts read the two very differently.
  if (!summary || !summary.ended) return null;

  const { attendance, money: m } = summary;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="flex items-center gap-2 font-semibold text-gray-900">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        How it went
      </h2>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-3xl font-semibold text-gray-900">{attendance.counted}</span>
        <span className="text-sm text-gray-500">
          {attendance.basis === 'check-ins'
            ? `checked in${attendance.expected > attendance.counted ? ` of ${attendance.expected} expected` : ''}`
            : 'RSVPed'}
        </span>
      </div>
      {attendance.basis === 'rsvps' && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-gray-500">
          <Users className="mt-0.5 h-3 w-3 shrink-0" />
          {/* Said plainly rather than presenting RSVPs as attendance. */}
          Nobody was checked in at the door, so this is who said they were coming.
        </p>
      )}

      {m && (
        <dl className="mt-5 space-y-2 border-t border-gray-100 pt-4 text-sm">
          <div className="flex flex-wrap justify-between gap-3">
            <dt className="text-gray-500">
              Tickets sold
              {m.refundedCount > 0 && (
                <span className="text-gray-400"> ({m.refundedCount} refunded)</span>
              )}
            </dt>
            <dd className="font-medium text-gray-900">{m.ticketCount}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-3">
            <dt className="text-gray-500">Ticket sales</dt>
            <dd className="font-medium text-gray-900">{money(m.grossCents)}</dd>
          </div>
          {m.coopShareCents > 0 && (
            <div className="flex flex-wrap justify-between gap-3">
              <dt className="text-gray-500">The co-op&rsquo;s share</dt>
              <dd className="text-gray-600">−{money(m.coopShareCents)}</dd>
            </div>
          )}
          <div className="flex flex-wrap justify-between border-t border-gray-100 pt-2 gap-3">
            <dt className="font-medium text-gray-900">Yours</dt>
            <dd className="font-semibold text-gray-900">{money(m.netCents)}</dd>
          </div>
          <p className="pt-1 text-xs text-gray-500">
            {m.status === 'PAID' && m.paidAt
              ? `Paid on ${new Date(m.paidAt).toLocaleDateString()}.`
              : m.status === 'CANCELLED'
                ? 'This payout was canceled.'
                : 'Not paid out yet — an organizer settles these.'}
          </p>
        </dl>
      )}

      {!m && (
        <p className="mt-4 border-t border-gray-100 pt-4 text-sm text-gray-500">
          A free event, so there is nothing to settle.
        </p>
      )}
    </section>
  );
}

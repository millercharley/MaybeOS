'use client';

import { useEffect, useState } from 'react';
import { api, HostPayoutPreview } from '@/lib/api';
import { money } from '@/lib/fees';

/**
 * What a member is owed for the events they hosted (EVT-15).
 *
 * On My Events, where a host already looks, rather than a page of its own.
 *
 * It says who owes it and that MaybeOS is not the one paying, because the
 * honest version is the useful one: a host who thinks a platform is sending
 * their money waits for a deposit that is never coming, and asks the wrong
 * person about it.
 */
export function HostEarnings({ orgId, token }: { orgId: string; token: string }) {
  const [rows, setRows] = useState<HostPayoutPreview[]>([]);

  useEffect(() => {
    let live = true;
    api.events
      .myHostPayouts(orgId, token)
      .then((found) => live && setRows(found.filter((r) => r.amountCents > 0)))
      // Silent: somebody who has never hosted a ticketed event should not be
      // shown an error about earnings they were never going to have.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [orgId, token]);

  if (rows.length === 0) return null;

  const owed = rows.filter((r) => r.payout?.status !== 'PAID');
  const owedTotal = owed.reduce((n, r) => n + r.amountCents, 0);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">From your ticket sales</h2>
        {owedTotal > 0 && (
          <p className="text-sm text-gray-500">
            <b className="text-gray-900">{money(owedTotal)}</b> to come
          </p>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {rows.map((row) => {
          const paid = row.payout?.status === 'PAID';
          return (
            <li key={row.eventId} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="text-gray-900">{row.title}</span>
                <span className="text-gray-400">
                  {' '}· {row.ticketCount} {row.ticketCount === 1 ? 'ticket' : 'tickets'}
                  {row.shareBps !== 10000 && ` · your share ${row.shareBps / 100}%`}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="text-gray-900">{money(row.amountCents)}</span>{' '}
                <span className={paid ? 'text-green-700' : 'text-gray-400'}>
                  {paid
                    ? `paid${row.payout?.paidAt ? ` ${new Date(row.payout.paidAt).toLocaleDateString()}` : ''}`
                    : row.hasEnded
                      ? 'to come'
                      : 'after the event'}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">
        {/* The two facts a host actually needs: what the number means, and who
            is sending it. */}
        This is your ticket price — MaybeOS&apos;s fee and any venue fee were added on top for the
        buyer and never came out of your share. Your co-op pays it after the event; ask an
        organizer if it hasn&apos;t arrived.
      </p>
    </section>
  );
}

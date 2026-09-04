'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, CalendarDays, CheckCircle2, CreditCard, Loader2, Mail } from 'lucide-react';
import { api, ConnectStatus, Room } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * What this co-op is connected to, and what it is not (INT-01).
 *
 * This tab used to be three rows reading "Coming soon" — Stripe, Google
 * Calendar and an email provider. Two of the three had shipped: Stripe Connect
 * takes ticket money on the co-op's own account (D-013), and a room's calendar
 * has been syncing with Google since SPC-04. So an admin who came here to
 * check whether payments were set up was told the feature did not exist yet,
 * while the co-op was already selling tickets through it.
 *
 * A settings screen that is wrong is worse than one that is missing: the
 * missing one sends somebody looking, and the wrong one stops them.
 *
 * Now each row states what is actually true and says where the thing is
 * managed — because neither is managed *here*, and pretending otherwise would
 * be the same mistake in a new shape. Stripe belongs with the ticket fee it
 * sets, and a calendar belongs to a room rather than to the co-op.
 */
export function Integrations({ onGoToGeneral }: { onGoToGeneral?: () => void }) {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);
  const orgSlug = useParams()?.orgSlug as string | undefined;

  const [stripe, setStripe] = useState<ConnectStatus | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    // Settled rather than all: a co-op with no rooms and a co-op whose Stripe
    // check fails should each still see the row that did answer.
    const [connect, roomList] = await Promise.allSettled([
      api.connect.status(orgId, token),
      api.rooms.list(orgId, token),
    ]);
    if (connect.status === 'fulfilled') setStripe(connect.value);
    if (roomList.status === 'fulfilled') setRooms(roomList.value);
    setLoading(false);
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <section className="card flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </section>
    );
  }

  const withCalendar = (rooms ?? []).filter((r) => r.googleCalendarId).length;
  const roomCount = (rooms ?? []).length;

  return (
    <div className="space-y-4">
      <Row
        icon={CreditCard}
        name="Stripe"
        what="Takes ticket and membership money into your co-op's own Stripe account. MaybeOS is never the merchant."
        state={
          !stripe || !stripe.connected
            ? { tone: 'off', label: 'Not connected' }
            : stripe.chargesEnabled
              ? { tone: 'on', label: 'Connected — taking payments' }
              : { tone: 'partial', label: 'Started, not finished' }
        }
        detail={
          stripe?.connected && !stripe.chargesEnabled
            ? 'Stripe still wants something before this co-op can be paid. Finish it under Ticket payouts.'
            : undefined
        }
        action={
          onGoToGeneral && (
            <button
              type="button"
              onClick={onGoToGeneral}
              className="text-sm font-medium text-brand-600 hover:underline"
            >
              {stripe?.connected ? 'Ticket payouts' : 'Set it up'}
            </button>
          )
        }
      />

      <Row
        icon={CalendarDays}
        name="Google Calendar"
        what="Keeps a room's bookings and its Google calendar in step, both ways. Connected per room rather than per co-op, because a co-op with three rooms usually has three calendars."
        state={
          roomCount === 0
            ? { tone: 'off', label: 'No rooms yet' }
            : withCalendar === 0
              ? { tone: 'off', label: 'Not connected' }
              : withCalendar === roomCount
                ? { tone: 'on', label: `Connected on all ${roomCount} rooms` }
                : { tone: 'partial', label: `Connected on ${withCalendar} of ${roomCount} rooms` }
        }
        action={
          orgSlug && (
            <Link
              href={`/admin/${orgSlug}/rooms`}
              className="text-sm font-medium text-brand-600 hover:underline"
            >
              Rooms &amp; Booking
            </Link>
          )
        }
      />

      <Row
        icon={Mail}
        name="Email"
        what="MaybeOS sends invitations, booking notices and reminders on your co-op's behalf. There is no account to connect — what you can set is the address members reply to."
        state={{ tone: 'on', label: 'Sending' }}
        action={
          onGoToGeneral && (
            <button
              type="button"
              onClick={onGoToGeneral}
              className="text-sm font-medium text-brand-600 hover:underline"
            >
              Reply-to address
            </button>
          )
        }
      />
    </div>
  );
}

function Row({
  icon: Icon, name, what, state, detail, action,
}: {
  icon: typeof CreditCard;
  name: string;
  what: string;
  state: { tone: 'on' | 'off' | 'partial'; label: string };
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900">{name}</h3>
            <p className="mt-1 max-w-prose text-sm text-gray-500">{what}</p>
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        {/* The state, said in words rather than as a coloured dot. "Connected
            on 2 of 3 rooms" is something an admin can act on; a green light
            is something they have to go and check. */}
        {state.tone === 'on' ? (
          <span className="badge-success inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {state.label}
          </span>
        ) : state.tone === 'partial' ? (
          <span className="badge-warning inline-flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {state.label}
          </span>
        ) : (
          <span className="badge-neutral">{state.label}</span>
        )}
        {detail && <span className="text-sm text-gray-500">{detail}</span>}
      </div>
    </section>
  );
}

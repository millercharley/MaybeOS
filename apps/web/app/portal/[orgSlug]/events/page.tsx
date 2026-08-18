'use client';

import { useState, useEffect } from 'react';
import { Calendar, Users } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { usePublicApi } from '@/hooks/use-api';
import { api } from '@/lib/api';
import { ticketCost, describeFees, money } from '@/lib/fees';

export default function PortalEventsPage() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const [rsvpingId, setRsvpingId] = useState<string | null>(null);
  // What the API actually decided, per event — not merely that a request
  // was made. A waitlisted place and a confirmed one are different news.
  const [rsvpStatus, setRsvpStatus] = useState<Record<string, 'CONFIRMED' | 'WAITLISTED'>>({});
  const [rsvpError, setRsvpError] = useState<Record<string, string>>({});

  // A member of *this* co-op sees its members-only events too. Anonymous
  // visitors, and members of some other co-op, see only what is public.
  // Without this the portal showed the public list to everybody, while a new
  // event defaults to MEMBERS_ONLY — so a co-op's own events were invisible
  // to its own members and the page looked empty rather than restricted.
  const isMember = Boolean(org && user?.orgs?.some((o) => o.orgId === org.id));

  const { data: events, loading } = usePublicApi(
    () =>
      !org
        ? Promise.resolve([])
        : isMember && token
          ? api.events.listVisible(org.id, token)
          : api.events.listPublic(org.id),
    [org?.id, isMember, token],
  );

  /**
   * What Stripe sent them back with.
   *
   * A buyer who has just paid needs to be told so. There was a confirmation
   * screen for this on the old public event page, and that page was deleted
   * with the hardcoded org it was wired to (OPS-22) — so the acknowledgement
   * went with it and `?purchased=1` was being written and read by nobody.
   *
   * Deliberately says the ticket is *confirmed*, not that it exists: the
   * ticket is written by the webhook, which may land a moment after the
   * redirect. Claiming a row that is not there yet would be the one lie a
   * payment screen must not tell.
   */
  const [returned, setReturned] = useState<'purchased' | 'cancelled' | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('purchased') === '1') setReturned('purchased');
    else if (params.get('purchase') === 'cancelled') setReturned('cancelled');
  }, []);

  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<Record<string, string>>({});

  /**
   * Send a buyer to Stripe for a ticketed event.
   *
   * The charge is created on the co-op's own connected account, so the co-op
   * is the merchant and MaybeOS's cut rides along as the application fee
   * (D-013). Nothing is recorded here: the ticket is written by the
   * `checkout.session.completed` webhook, never on the redirect back, because
   * a buyer who closes the tab has still paid.
   */
  async function handleBuy(eventId: string) {
    if (!org) return;
    setBuyingId(eventId);
    setBuyError((e) => ({ ...e, [eventId]: '' }));
    try {
      const here = `${window.location.origin}${window.location.pathname}`;
      const { url } = await api.events.buyTicket(
        org.id,
        eventId,
        { successUrl: `${here}?purchased=1`, cancelUrl: `${here}?purchase=cancelled` },
        token ?? undefined,
      );
      window.location.assign(url);
    } catch (err) {
      // Left on the page with a reason, rather than a dead button. The common
      // one is a co-op that has not finished Stripe onboarding.
      setBuyError((e) => ({
        ...e,
        [eventId]: err instanceof Error ? err.message : 'Could not start checkout',
      }));
      setBuyingId(null);
    }
  }

  async function handleRsvp(eventId: string) {
    if (!token || !org) return;
    setRsvpingId(eventId);
    setRsvpError((prev) => ({ ...prev, [eventId]: '' }));
    try {
      const rsvp = await api.events.rsvp(org.id, eventId, token);
      setRsvpStatus((prev) => ({ ...prev, [eventId]: rsvp.status }));
    } catch (err) {
      // This was `catch {}`. A full event answers "Event is at capacity" and
      // the page said nothing at all — the member pressed RSVP, the button
      // stayed put, and no reason was ever given.
      setRsvpError((prev) => ({
        ...prev,
        [eventId]: err instanceof Error ? err.message : 'Could not RSVP',
      }));
    } finally {
      setRsvpingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  const eventList = events || [];
  const upcoming = eventList.filter((e) => new Date(e.startTime) > new Date());
  const past = eventList.filter((e) => new Date(e.startTime) <= new Date());

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Events</h1>

      {returned === 'purchased' && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4" role="status">
          <p className="text-sm font-medium text-green-800">Payment received — thank you.</p>
          <p className="mt-1 text-sm text-green-700">
            Your ticket is confirmed and a receipt is on its way from Stripe. If it does not
            appear in your RSVPs within a minute or two, tell an organiser — your payment
            went through either way.
          </p>
        </div>
      )}

      {returned === 'cancelled' && (
        <div className="rounded-xl border border-gray-200 bg-white p-4" role="status">
          <p className="text-sm text-gray-600">
            Checkout cancelled — you have not been charged.
          </p>
        </div>
      )}

      {upcoming.length === 0 && past.length === 0 && (
        <p className="py-12 text-center text-sm text-gray-500">No events yet.</p>
      )}

      {upcoming.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Upcoming</h2>
          <div className="space-y-4">
            {upcoming.map((event) => (
              <div
                key={event.id}
                className="flex items-start justify-between rounded-xl border border-gray-200 bg-white p-5"
              >
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-gray-900">{event.title}</h3>
                  {event.description && (
                    <p className="mt-1 text-sm text-gray-500 line-clamp-2">{event.description}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {new Date(event.startTime).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                    {event.capacity && (
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        {event.rsvpCount ?? 0} / {event.capacity}
                      </span>
                    )}
                    {event.category && (
                      <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                        {event.category}
                      </span>
                    )}
                  </div>
                </div>
                <div className="ml-4 shrink-0">
                  {/* Charley's call: on a ticketed event, buying *is* the
                      action. An RSVP beside a price is two ways to say you are
                      coming, only one of which pays the co-op. */}
                  {event.priceCents ? (
                    (() => {
                      const cost = ticketCost({
                        ticketCents: event.priceCents,
                        plan: org?.plan,
                        orgFeeCents: org?.ticketFeeCents ?? 0,
                      });
                      const fees = describeFees(cost);

                      if (!org?.stripeChargesEnabled) {
                        return (
                          <span className="text-xs text-gray-400">
                            Tickets aren&apos;t on sale yet
                          </span>
                        );
                      }

                      return (
                        <div className="text-right">
                          <button
                            onClick={() => handleBuy(event.id)}
                            disabled={buyingId === event.id}
                            className="btn-primary text-sm"
                          >
                            {buyingId === event.id
                              ? 'Opening checkout...'
                              : `Buy ticket · ${money(cost.totalCents)}`}
                          </button>
                          {/* Named before they leave the page, not discovered
                              on Stripe's. */}
                          {fees && <p className="mt-1 text-xs text-gray-400">{fees}</p>}
                          {buyError[event.id] && (
                            <p className="mt-1 max-w-[14rem] text-xs text-red-600" role="alert">
                              {buyError[event.id]}
                            </p>
                          )}
                        </div>
                      );
                    })()
                  ) : token ? (
                    rsvpStatus[event.id] ? (
                      <span
                        className={`text-sm font-medium ${
                          rsvpStatus[event.id] === 'WAITLISTED'
                            ? 'text-amber-600'
                            : 'text-green-600'
                        }`}
                      >
                        {rsvpStatus[event.id] === 'WAITLISTED'
                          ? "You're on the waitlist"
                          : "RSVP'd"}
                      </span>
                    ) : (
                      <div className="text-right">
                        <button
                          onClick={() => handleRsvp(event.id)}
                          disabled={rsvpingId === event.id}
                          className="btn-primary text-sm"
                        >
                          {rsvpingId === event.id ? 'Sending...' : 'RSVP'}
                        </button>
                        {rsvpError[event.id] && (
                          <p className="mt-1 max-w-[12rem] text-xs text-red-600" role="alert">
                            {rsvpError[event.id]}
                          </p>
                        )}
                      </div>
                    )
                  ) : (
                    <span className="text-xs text-gray-400">Sign in to RSVP</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Past Events</h2>
          <div className="space-y-3">
            {past.map((event) => (
              <div
                key={event.id}
                className="rounded-xl border border-gray-100 bg-white p-4 opacity-70"
              >
                <h3 className="text-sm font-medium text-gray-700">{event.title}</h3>
                <p className="mt-1 text-xs text-gray-400">
                  {new Date(event.startTime).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { Panel } from '@/components/layout/panel';
import { NextEventCard, EventRow, type EventActions } from '@/components/events/event-cards';
import { groupUpcoming } from '@/lib/event-list';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { usePublicApi } from '@/hooks/use-api';
import { api } from '@/lib/api';
import { TouchpointAsk } from '@/components/impact/touchpoint-ask';
import { PageHeader } from '@/components/layout/page-header';

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
  const now = new Date();
  const timeZone = eventList[0]?.timezone ?? 'America/New_York';
  const { next, months } = groupUpcoming(eventList, timeZone, now);
  const past = eventList
    .filter((e) => new Date(e.startTime) <= now)
    .sort((a, b) => b.startTime.localeCompare(a.startTime));

  const actions: EventActions = {
    orgSlug: org?.slug ?? '',
    isMember,
    busyId: rsvpingId ?? buyingId,
    rsvpStatus,
    errors: { ...rsvpError, ...buyError },
    onRsvp: handleRsvp,
    onBuy: handleBuy,
    plan: org?.plan,
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Events"
      />{returned === 'purchased' && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4" role="status">
          <p className="text-sm font-medium text-green-800">Payment received — thank you.</p>
          <p className="mt-1 text-sm text-green-700">
            Your ticket is confirmed and a receipt is on its way from Stripe. If it does not
            appear in your RSVPs within a minute or two, tell an organiser — your payment
            went through either way.
          </p>
        </div>
      )}

      {/* The moment the PRD asks for, restored. This rendered on the public
          event page deleted in OPS-22; the confirmation was rebuilt here and
          the question was not brought with it, so IMP-15 shipped and then
          asked nobody. Gated on having just paid rather than on visiting the
          page, because "after buying a ticket" is the moment. */}
      {returned === 'purchased' && org && (
        <TouchpointAsk orgId={org.id} touchpoint="TICKET_PURCHASE" />
      )}

      {returned === 'cancelled' && (
        <div className="rounded-xl border border-gray-200 bg-white p-4" role="status">
          <p className="text-sm text-gray-600">
            Checkout cancelled — you have not been charged.
          </p>
        </div>
      )}

      {!next && past.length === 0 && (
        <p className="py-12 text-center text-[var(--text-secondary)]">
          Nothing on the calendar yet.
        </p>
      )}

      {/*
        The next thing happening, given the room it deserves (EVT-19). The old
        list was one flat run of cards, so tonight looked exactly like
        November — and the question most people open an events page with is
        whether anything is on soon.
      */}
      {next && (
        <Panel title="Next event">
          <NextEventCard event={next} actions={actions} now={now} />
        </Panel>
      )}

      {months.map((month) => (
        <Panel key={month.heading} title={month.heading}>
          <ul className="-mx-5 -mb-5 border-t border-[var(--border)]">
            {month.events.map((event) => (
              <EventRow key={event.id} event={event} actions={actions} />
            ))}
          </ul>
        </Panel>
      ))}

      {past.length > 0 && (
        <Panel title={<span className="text-[var(--text-secondary)]">Already happened</span>}>
          <ul className="-mx-5 -mb-5 border-t border-[var(--border)] opacity-70">
            {past.slice(0, 10).map((event) => (
              <EventRow key={event.id} event={event} actions={actions} />
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

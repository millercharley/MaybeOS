'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { DoorOpen, ArrowLeft, Calendar, MapPin, Users, Ticket } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { doorCost } from '@/lib/event-list';
import { api, Event, Comment } from '@/lib/api';
import { renderBodyHtml, isBlankBody } from '@/lib/rich-text';
import { RichComposer, composerValue } from '@/components/composer/rich-composer';
import { AttachmentList } from '@/components/composer/attachment-list';
import { RsvpFaces } from '@/components/events/rsvp-faces';
import { uploadAttachments } from '@/lib/attachments';
import { ticketCost, describeFees, money } from '@/lib/fees';
import { eventArt } from '@/lib/event-art';
import { PageHeader } from '@/components/layout/page-header';
import { maturityBadge } from '@/lib/maturity';
import { MemberName } from '@/components/member/member-name';
import { rsvpRequested, shouldRsvpOnArrival, withoutRsvpParam } from '@/lib/radar-rsvp';

/**
 * One event, at the size an event deserves (EVT-08, EVT-11).
 *
 * The events list read like a table of titles and times, which is a strange
 * way to present the most public thing a co-op has. This is the page a link
 * shared on social lands on: the poster first, then when and where, who is
 * running it, and a way to come.
 *
 * Deleting the old `/events/[slug]` page (OPS-22) left members and the public
 * with no event detail at all — it was hardcoded to a dev org and could never
 * have worked. This replaces it under the co-op's own portal, where the slug
 * in the address names the co-op rather than being assumed.
 */
export default function PortalEventPage(props: {
  params: Promise<{ orgSlug: string; eventSlug: string }>;
}) {
  const { orgSlug, eventSlug } = use(props.params);
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  // The portal layout already holds every page back until the session is
  // known, but the Radar arrival below acts without being asked — it checks
  // this itself rather than inheriting the guarantee from a parent that
  // could reasonably be rearranged later.
  const authLoading = useAuthStore((s) => s.isLoading);

  // A member of *this* co-op, not merely somebody signed in. A member of some
  // other co-op sees exactly what the public sees.
  const isMember = Boolean(org && user?.orgs?.some((o) => o.orgId === org.id));

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rsvpStatus, setRsvpStatus] = useState<'CONFIRMED' | 'WAITLISTED' | null>(null);
  const [rsvpError, setRsvpError] = useState('');
  /** Whether the question "is this member already coming?" has been answered. */
  const [rsvpKnown, setRsvpKnown] = useState(false);

  /**
   * Where to come back to after signing in.
   *
   * Read in an effect rather than while rendering: the query string only
   * exists in the browser, and reading `window.location` during the render
   * would produce different markup from the one the server sent. Null until
   * then, which is the same on both sides.
   */
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => {
    setReturnTo(window.location.pathname + window.location.search);
  }, []);

  /**
   * Signing in from here has to come back *here*, with everything the address
   * carried.
   *
   * This page is one of the two the portal guard deliberately leaves open
   * (AUTH-08), so nobody redirected a signed-out visitor to get here and
   * nothing is holding their place — the link used to be a bare `/login`,
   * which signed them in and dropped them on their own dashboard. The Radar
   * digest makes that concrete: `?rsvp=radar` is the thing they clicked, and
   * losing it means signing in and then having to find the RSVP button
   * themselves.
   */
  const signInHref = returnTo
    ? `/login?redirect=${encodeURIComponent(returnTo)}`
    : '/login';

  useEffect(() => {
    let cancelled = false;

    // A member of this co-op reads its own list first. The public by-slug
    // endpoint returns 404 for a members-only event — correctly, it answers
    // to the open internet — so going public-first would have told a co-op
    // its own event did not exist. The member list also carries the host,
    // which the public payload deliberately withholds.
    //
    // Everyone else gets the public read, which is what a link shared on
    // social has to land on.
    const read = isMember && org && token
      ? api.events
          .listVisible(org.id, token)
          .then((all) => all.find((e) => e.slug === eventSlug))
          .then((found) => found ?? api.events.getPublicBySlug(orgSlug, eventSlug))
      : api.events.getPublicBySlug(orgSlug, eventSlug);

    read
      .then((found) => {
        if (!cancelled) setEvent(found);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load that event');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgSlug, eventSlug, org, token, isMember]);

  /**
   * Whether this member is already coming.
   *
   * The page never asked. `rsvpStatus` started empty on every visit, so a
   * member who had already RSVPed was shown the button again, and the API
   * answers a repeat with a 409 — "You have already RSVPed to this event" —
   * which this page renders as the RSVP error. That was a wart while a
   * person had to press the button themselves. The Radar digest's RSVP link
   * makes the page press it unprompted, so the page has to know the answer
   * before it acts, or opening the second digest greets a member with an
   * error about a seat they already hold.
   */
  useEffect(() => {
    if (!isMember || !token) {
      // Nobody who could be holding one. Settled rather than left pending,
      // or the arrival below waits forever for an answer that is not coming.
      setRsvpKnown(true);
      return;
    }
    if (!org || !event) return;

    let cancelled = false;
    api.events
      .myRsvps(org.id, token)
      .then((mine) => {
        if (cancelled) return;
        const held = mine.find((r) => r.event.id === event.id);
        // CANCELED is not a seat, and the API revives one rather than
        // refusing it — somebody who canceled and then followed a fresh
        // digest link means to come after all.
        if (held?.status === 'CONFIRMED' || held?.status === 'WAITLISTED') {
          setRsvpStatus(held.status);
        }
      })
      .catch(() => {
        // Deliberately quiet. The button still works and the API still
        // refuses a duplicate, so a failed read costs the page nothing it
        // did not already live without.
      })
      .finally(() => {
        if (!cancelled) setRsvpKnown(true);
      });

    return () => {
      cancelled = true;
    };
  }, [org, token, isMember, event]);

  /**
   * The ref is what makes the arrival below happen once. React re-runs an
   * effect whenever its inputs move, and the inputs here are loading flags —
   * without it, a second RSVP would be posted the moment anything else on
   * the page settled.
   */
  const arrivalHandled = useRef(false);

  /**
   * `?rsvp=radar` — the RSVP button in a Radar digest (RDR-01).
   *
   * The digest links to this page rather than to an endpoint, so pressing it
   * lands the member on the event with their seat already taken: the page is
   * the confirmation. Which arrivals may act, and why each guard exists,
   * lives in `lib/radar-rsvp.ts`; this is the plumbing around it.
   */
  useEffect(() => {
    if (arrivalHandled.current) return;
    if (authLoading || loading) return;
    // An event that loaded but whose RSVP has not been read yet is not ready.
    // One that failed to load never will be, and should still clear the flag
    // off the address.
    if (event && !rsvpKnown) return;
    if (!rsvpRequested(window.location.search)) return;

    arrivalHandled.current = true;

    // Cleared as soon as the page commits, rather than after the call
    // answers — a refresh mid-flight would otherwise start a second one.
    // `history.replaceState` rather than `router.replace`, matching the rooms
    // and reports pages: the job is to rewrite the address without re-running
    // the route, and re-running it would refetch the event underneath us.
    window.history.replaceState(
      {},
      '',
      withoutRsvpParam(window.location.pathname, window.location.search),
    );

    const go = shouldRsvpOnArrival({
      requested: true,
      ready: Boolean(event && org),
      canRsvp: isMember && Boolean(token),
      ticketed: Boolean(event?.priceCents),
      existing: rsvpStatus,
    });

    // Declining is not a silent no-op: an RSVP already held is already
    // rendered as "You're going", a signed-out reader already has the
    // sign-in prompt, and a ticketed event already shows Buy. Each of those
    // is the page's own answer to "can I come", which is what the member
    // followed the link to find out.
    if (go) rsvp();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, loading, rsvpKnown, event, org, isMember, token, rsvpStatus]);

  async function rsvp() {
    if (!org || !token || !event) return;
    setBusy(true);
    setRsvpError('');
    try {
      const created = await api.events.rsvp(org.id, event.id, token);
      setRsvpStatus(created.status);
    } catch (err) {
      // A full event answers "Event is at capacity", which is news rather than
      // a fault — said here rather than swallowed.
      setRsvpError(err instanceof Error ? err.message : 'Could not RSVP');
    } finally {
      setBusy(false);
    }
  }

  async function buy() {
    if (!org || !event) return;
    setBusy(true);
    try {
      const here = window.location.href.split('?')[0];
      const { url } = await api.events.buyTicket(
        org.id,
        event.id,
        { successUrl: `${here}?purchased=1`, cancelUrl: `${here}?purchase=canceled` },
        token ?? undefined,
      );
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout');
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="py-16 text-center">
        <Calendar className="mx-auto h-10 w-10 text-gray-300" />
        <PageHeader
          title="Event not found"
        />
        <Link href={`/portal/${orgSlug}/events`} className="btn-secondary mt-6 inline-block text-sm">
          All events
        </Link>
      </div>
    );
  }

  const start = new Date(event.startTime);
  const end = event.endTime ? new Date(event.endTime) : null;
  const cost = event.priceCents
    ? ticketCost({
        ticketCents: event.priceCents,
        plan: org?.plan,
        orgFeeCents: org?.ticketFeeCents ?? 0,
      })
    : null;

  return (
    <div className="space-y-6">
      <Link
        href={`/portal/${orgSlug}/events`}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        All events
      </Link>

      {/* The poster first. It is what a co-op made to advertise this, and the
          old list showed none of it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={eventArt({
          id: event.id,
          title: event.title,
          tags: event.tags,
          category: event.category,
          roomName: event.room?.name ?? null,
          imageUrl: event.imageUrl,
        })}
        alt=""
        className="max-h-96 w-full rounded-2xl object-cover"
      />

      {/* Whoever took it (EVT-22). Unsplash's terms require the photographer's
          name and a link back wherever their photo appears, so this is not
          decoration — an uncredited photo is a licence breach. Rendered only
          when there is somebody to credit, which an upload or a pasted URL
          has not. */}
      {event.imageCredit && (
        <p className="-mt-4 text-xs text-gray-400">
          Photo by{' '}
          {event.imageCreditUrl ? (
            <a
              href={event.imageCreditUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="underline hover:text-gray-600"
            >
              {event.imageCredit}
            </a>
          ) : (
            event.imageCredit
          )}{' '}
          on Unsplash
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <div>
            <h1 className="font-display text-2xl leading-tight text-ink">{event.title}</h1>
            {event.host?.name ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-gray-500">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-[11px] font-medium text-brand-700">
                  {event.host.name.charAt(0).toUpperCase()}
                </span>
                Hosted by <MemberName userId={event.host.id} name={event.host.name} />
              </p>
            ) : (
              /* Somebody who ran this and is not a member here (CAL-03) —
                 usually a past member, on an event imported from the co-op's
                 own calendar. Their name, with no card to open and no way to
                 message them, because there is nobody to open or message. */
              event.hostName && (
                <p className="mt-2 flex items-center gap-2 text-sm text-gray-500">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-[11px] font-medium text-gray-500">
                    {event.hostName.charAt(0).toUpperCase()}
                  </span>
                  Hosted by <span className="text-gray-700">{event.hostName}</span>
                </p>
              )
            )}
          </div>

          {event.description && (
            <div
              className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-700"
              dangerouslySetInnerHTML={{ __html: renderBodyHtml(event.description) }}
            />
          )}

          {/* The poster, to whoever is looking (EVT-14). A member reads it
              through the co-op; anybody else reads it through the public
              route, which only serves a published PUBLIC event's own files.
              Before this the page rendered for a stranger and the images the
              co-op was advertising with did not. */}
          {org && token && isMember ? (
            <AttachmentList orgId={org.id} token={token} eventId={event.id} />
          ) : (
            org &&
            event.visibility === 'PUBLIC' && (
              <AttachmentList
                orgId={org.id}
                token=""
                publicEvent={{ orgSlug, eventSlug }}
              />
            )
          )}

          {/* Members only, deliberately: an event page is public, the co-op's
              conversation about it is not. */}
          {org && token && isMember ? (
            <EventDiscussion orgId={org.id} eventId={event.id} token={token} />
          ) : (
            <p className="border-t border-gray-200 pt-6 text-sm text-gray-500">
              Members of {org?.name ?? 'this co-op'} can discuss this event.{' '}
              <Link href={signInHref} className="text-brand-600 hover:underline">Sign in</Link>.
            </p>
          )}
        </div>

        {/* When, where, and how to come — kept beside the detail so it stays on
            screen while somebody reads. */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-gray-100">
                <span className="text-base font-bold leading-none text-gray-900">{start.getDate()}</span>
                <span className="text-[10px] uppercase tracking-wide text-gray-500">
                  {start.toLocaleDateString(undefined, { month: 'short' })}
                </span>
              </div>
              <div className="min-w-0 text-sm">
                <p className="font-medium text-gray-900">
                  {start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                </p>
                <p className="text-gray-500">
                  {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  {end ? ` – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}
                </p>
              </div>
            </div>

            {/* The room is what somebody has to find once they are in the
                building, and it was replaced by the venue name rather than
                shown beside it — so an event in the Attic said only
                "MaybeItsFate". */}
            {event.room?.name && (
              <p className="mt-4 flex items-center gap-3 border-t border-gray-100 pt-4 text-sm">
                <DoorOpen className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="font-medium text-gray-900">{event.room.name}</span>
              </p>
            )}

            {(event.location?.name || event.room?.name) && (
              <div className="mt-4 flex items-start gap-3 border-t border-gray-100 pt-4 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {event.location?.name ?? 'In person'}
                  </p>
                  {event.location?.address && (
                    <a
                      className="text-gray-500 hover:text-brand-600"
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                        [event.location.address, event.location.city, event.location.state]
                          .filter(Boolean)
                          .join(', '),
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {event.location.address}
                    </a>
                  )}
                </div>
              </div>
            )}

            {event.capacity ? (
              <p className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-4 text-sm text-gray-500">
                <Users className="h-4 w-4 text-gray-400" />
                {event.rsvpCount ?? 0} of {event.capacity} places taken
              </p>
            ) : null}

            {/*
              Saying you are coming, which this page could not do (EVT-19). It
              offered Buy on a ticketed event and nothing at all on a free one
              — so the page a member opens to read about an event was the one
              place they could not RSVP to it.
            */}
            {!cost && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                {rsvpStatus ? (
                  <p className="rounded-lg border border-[var(--success)] px-3 py-2 text-center text-sm font-medium">
                    {rsvpStatus === 'CONFIRMED' ? "You're going" : "You're on the waitlist"}
                  </p>
                ) : isMember && token ? (
                  <button onClick={rsvp} disabled={busy} className="btn-primary w-full text-sm">
                    {busy ? 'Saving…' : 'RSVP'}
                  </button>
                ) : (
                  <p className="text-center text-sm text-gray-500">
                    <Link href={signInHref} className="text-brand-600 hover:underline">
                      Sign in
                    </Link>{' '}
                    to RSVP.
                  </p>
                )}
                {rsvpError && (
                  <p className="mt-1.5 text-center text-xs text-[var(--danger)]">{rsvpError}</p>
                )}
              </div>
            )}

            {/* Charged at the door rather than ticketed here — most co-op
                events that cost money work that way, and silence reads as
                free (EVT-17). */}
            {maturityBadge(event.maturityLevel) && (
              // Said before anything about money: it decides whether somebody
              // can come at all, and this page is often read by a stranger
              // from a link (SPC-22).
              <p className="mt-3 text-center text-sm font-medium text-gray-900">
                Ages {maturityBadge(event.maturityLevel)}
              </p>
            )}
            {!cost && doorCost(event) && (
              // "Ask the host" was what this said when the product did not
              // know the answer (EVT-34). Now it often does.
              <p className="mt-3 text-center text-xs text-gray-500">{doorCost(event)}</p>
            )}

            {cost ? (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <button
                  onClick={buy}
                  disabled={busy || !org?.stripeChargesEnabled}
                  className="btn-primary w-full text-sm"
                >
                  <Ticket className="mr-1.5 inline h-4 w-4" />
                  {busy ? 'Opening checkout...' : `Buy ticket · ${money(cost.totalCents)}`}
                </button>
                {/* Named before anyone leaves the page, not discovered on
                    Stripe's. */}
                {describeFees(cost) && (
                  <p className="mt-1.5 text-center text-xs text-gray-400">{describeFees(cost)}</p>
                )}
                {!org?.stripeChargesEnabled && (
                  <p className="mt-1.5 text-center text-xs text-gray-400">
                    Tickets aren&apos;t on sale yet.
                  </p>
                )}
              </div>
            ) : null}
          </div>

          {/*
            Who else is going. People decide based on this more than on the
            description, and the page showed a count at most (UX-03). Members
            only: an event link may be public so strangers can RSVP, but the
            guest list is not.
          */}
          {isMember && event.rsvpFaces?.length ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <p className="text-sm font-medium text-gray-900">
                {event.rsvpCount ?? event.rsvpFaces.length}{' '}
                {(event.rsvpCount ?? event.rsvpFaces.length) === 1 ? 'attendee' : 'attendees'}
              </p>
              <div className="mt-3">
                <RsvpFaces
                  faces={event.rsvpFaces}
                  total={event.rsvpCount ?? event.rsvpFaces.length}
                  size="md"
                />
              </div>
            </div>
          ) : null}

          {/*
            An event in no room is an event with nowhere to happen. The host
            can fix that from here rather than discovering it on the night —
            and booking the room is where MaybeOS then captures everything
            this page needs anyway (SPC-21).
          */}
          {!event.room && isMember && (
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <p className="text-sm font-medium text-gray-900">No room booked</p>
              <p className="mt-1 text-sm text-gray-500">
                This event has nowhere to happen yet. Reserving a room also holds it against
                other bookings.
              </p>
              <Link
                href={`/portal/${orgSlug}/rooms`}
                className="btn-secondary mt-3 inline-flex w-full items-center justify-center gap-2 text-sm"
              >
                <DoorOpen className="h-4 w-4" />
                Reserve a room
              </Link>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * The conversation about an event.
 *
 * Runs against the post the event carries (EVT-11), so comments, replies,
 * flagging and moderation are the same code the Commons already uses — an
 * event does not get its own parallel comment system to keep in step.
 */
function EventDiscussion({ orgId, eventId, token }: { orgId: string; eventId: string; token: string }) {
  const [postId, setPostId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      /*
        A read (EVT-42).

        This used to create the thread, on the reasoning that making one per
        event would fill the Commons with empty threads. It filled them anyway
        — opening an event page was enough — and the posts were attributed to
        whoever had opened it. Three appeared in one browsing session, five
        days after those events were published, with no comments on any of
        them. The thread is made by the first comment now; see `submit`.
      */
      const { postId: id } = await api.events.thread(orgId, eventId, token);
      setPostId(id);
      if (id) {
        const post = await api.commons.getPost(orgId, id, token);
        setComments(post.comments ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the discussion');
    }
  }, [orgId, eventId, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (isBlankBody(draft) && files.length === 0) return;
    setBusy(true);
    setError('');
    try {
      /*
        The first comment is what makes the thread (EVT-42).

        Which means a thread in #Events is a conversation rather than a page
        somebody opened. A private event never gets one — the channel is read
        by the whole co-op — so there is nothing to post a comment onto.
      */
      const thread = postId ? { postId } : await api.events.startThread(orgId, eventId, token);
      if (!thread.postId) {
        setError('This event is private, so it has no discussion.');
        return;
      }
      setPostId(thread.postId);

      const comment = await api.commons.addComment(
        orgId,
        thread.postId,
        { body: composerValue(draft) },
        token,
      );
      if (files.length > 0) {
        await uploadAttachments(orgId, files, { commentId: comment.id }, token);
        setFiles([]);
      }
      setDraft('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your comment was not posted');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t border-gray-200 pt-6">
      <h2 className="mb-3 text-base font-semibold text-gray-900">
        {comments.length > 0 ? `${comments.length} comment${comments.length === 1 ? '' : 's'}` : 'Discussion'}
      </h2>

      {error && <p className="mb-3 text-sm text-red-600" role="alert">{error}</p>}

      <div className="mb-4 space-y-3">
        {comments.map((comment) => (
          <div key={comment.id} className="rounded-lg bg-gray-50 px-3 py-2">
            <div className="flex items-center gap-2">
              <MemberName
                userId={comment.author?.id}
                name={comment.author?.name || 'Member'}
                className="text-xs font-medium text-gray-900"
              />
              <span className="text-[11px] text-gray-400">
                {new Date(comment.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div
              className="prose prose-sm mt-0.5 max-w-none whitespace-pre-wrap text-sm text-gray-700"
              dangerouslySetInnerHTML={{ __html: renderBodyHtml(comment.body) }}
            />
            <AttachmentList orgId={orgId} token={token} commentId={comment.id} />
          </div>
        ))}
      </div>

      <RichComposer
        value={draft}
        onChange={setDraft}
        onSubmit={submit}
        placeholder="What are your thoughts?"
        submitLabel="Post"
        busy={busy}
        rows={2}
        files={files}
        onFilesChange={setFiles}
      />
    </section>
  );
}

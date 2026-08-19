'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Calendar, MapPin, Users, Ticket } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, Event, Comment } from '@/lib/api';
import { renderBodyHtml, isBlankBody } from '@/lib/rich-text';
import { RichComposer, composerValue } from '@/components/composer/rich-composer';
import { AttachmentList } from '@/components/composer/attachment-list';
import { uploadAttachments } from '@/lib/attachments';
import { ticketCost, describeFees, money } from '@/lib/fees';

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

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Public first, so this page renders for somebody arriving from a link
    // shared on social with no account. A signed-in member then re-reads it
    // through the co-op, which adds what the public payload withholds — the
    // host's name above all.
    api.events
      .getPublicBySlug(orgSlug, eventSlug)
      .then(async (found) => {
        if (cancelled) return;
        setEvent(found);
        if (!token || !org) return;
        try {
          const full = await api.events.get(org.id, found.id, token);
          if (!cancelled) setEvent(full);
        } catch {
          // The public view is already on screen and is enough to attend by.
        }
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
  }, [orgSlug, eventSlug, org, token]);

  async function buy() {
    if (!org || !event) return;
    setBusy(true);
    try {
      const here = window.location.href.split('?')[0];
      const { url } = await api.events.buyTicket(
        org.id,
        event.id,
        { successUrl: `${here}?purchased=1`, cancelUrl: `${here}?purchase=cancelled` },
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
        <h1 className="mt-4 text-xl font-semibold text-gray-900">Event not found</h1>
        <p className="mt-2 text-sm text-gray-500">{error || 'It may have been cancelled.'}</p>
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
      {event.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={event.imageUrl}
          alt=""
          className="max-h-96 w-full rounded-2xl object-cover"
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{event.title}</h1>
            {event.host?.name && (
              <p className="mt-2 flex items-center gap-2 text-sm text-gray-500">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-[11px] font-medium text-brand-700">
                  {event.host.name.charAt(0).toUpperCase()}
                </span>
                Hosted by {event.host.name}
              </p>
            )}
          </div>

          {event.description && (
            <div
              className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-700"
              dangerouslySetInnerHTML={{ __html: renderBodyHtml(event.description) }}
            />
          )}

          {org && token && <AttachmentList orgId={org.id} token={token} eventId={event.id} />}

          {/* Members only, deliberately: an event page is public, the co-op's
              conversation about it is not. */}
          {org && token ? (
            <EventDiscussion orgId={org.id} eventId={event.id} token={token} />
          ) : (
            <p className="border-t border-gray-200 pt-6 text-sm text-gray-500">
              Members of {org?.name ?? 'this co-op'} can discuss this event.{' '}
              <Link href="/login" className="text-brand-600 hover:underline">Sign in</Link>.
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

            {(event.location?.name || event.room?.name) && (
              <div className="mt-4 flex items-start gap-3 border-t border-gray-100 pt-4 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {event.location?.name ?? event.room?.name}
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
      // Created on first view rather than for every event: most events are
      // never discussed, and a post each would fill the Commons with empty
      // threads.
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
    if (!postId || (isBlankBody(draft) && files.length === 0)) return;
    setBusy(true);
    setError('');
    try {
      const comment = await api.commons.addComment(orgId, postId, { body: composerValue(draft) }, token);
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
              <span className="text-xs font-medium text-gray-900">{comment.author?.name || 'Member'}</span>
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

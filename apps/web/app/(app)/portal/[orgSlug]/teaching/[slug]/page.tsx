'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import { api, type Offering, type OfferingInterest } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { PageHeader } from '@/components/layout/page-header';
import { Panel } from '@/components/layout/panel';
import { InterestList } from '@/components/teaching/interest-list';
import { SessionScheduler } from '@/components/teaching/session-scheduler';
import { isOpen, priceLabel, scheduleLabel } from '@/lib/teaching';
import { hasEnded } from '@/lib/event-tabs';
import { RichBody } from '@/components/composer/rich-body';
import { whenLabel } from '@/lib/event-list';
import { Discussion } from '@/components/commons/discussion';

/**
 * One offering (TCH-01).
 *
 * Three readers at once, and the page is mostly about keeping them apart:
 *
 *  - **A member deciding.** Wants what it is, who teaches it, when, and what
 *    it costs — then one button.
 *  - **The teacher.** Wants the dates and who has asked, which nobody else
 *    may see.
 *  - **Somebody who already said yes.** Wants to know that, rather than being
 *    offered the button again.
 *
 * `mayEdit` comes from the API rather than being worked out here, because the
 * server already answers it and two implementations of "is this mine" would
 * eventually disagree.
 */
export default function OfferingPage(props: {
  params: Promise<{ orgSlug: string; slug: string }>;
}) {
  const { orgSlug, slug } = use(props.params);
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [offering, setOffering] = useState<(Offering & { mayEdit: boolean }) | null>(null);
  const [interest, setInterest] = useState<OfferingInterest[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [error, setError] = useState('');

  /*
    What "when" means. A co-op's own timezone, not the reader's: somebody
    reading from another city is asking what is on at the *space* (DSH-01).
    Falls back to the browser's, which is right for a co-op that has not set
    one and wrong for nobody.
  */
  const timezone =
    useAuthStore.getState().user?.orgs?.find((o) => o.orgId === orgId)?.org?.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState(false);

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      const found = await api.teaching.get(orgId, slug, token);
      setOffering(found);
      setStatus('ready');

      if (found.mayEdit) {
        // Only the teacher, whoever wrote it up, or an organiser may read
        // this; the API refuses everybody else, so it is not even requested.
        setInterest(await api.teaching.interest(orgId, found.id, token));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      // A refusal and a miss answer the same, so slug-probing learns nothing.
      if (/not found/i.test(message)) setStatus('missing');
      else {
        setError(message || 'Could not load this.');
        setStatus('ready');
      }
    }
  }, [token, orgId, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function putHandUp() {
    if (!token || !orgId || !offering) return;
    setAsking(true);
    setError('');
    try {
      await api.teaching.registerInterest(orgId, offering.id, note.trim() || undefined, token);
      setAsked(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setAsking(false);
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  if (status === 'missing' || !offering) {
    return (
      <div className="space-y-6">
        <PageHeader title="Not here" />
        <Panel>
          <p className="text-sm text-[var(--text-secondary)]">
            This is not something the co-op is offering, or it is not open to you.
          </p>
          <Link
            href={`/portal/${orgSlug}/teaching`}
            className="mt-3 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            See what else is on offer
          </Link>
        </Panel>
      </div>
    );
  }

  /*
    What is still to come, and how many have been.

    `hasEnded` rather than a date comparison written here: it is the one place
    that decides what past means, and it measures from the *end*, so an
    evening in progress is not filed under history (EVT-49). Filtering rather
    than splitting is deliberate — a screen that lists no past events needs no
    tab for them, and a detail page is not the place for a second tab system.
    The whole run lives on the events screens, which have the tabs.
  */
  const all = offering.sessions ?? [];
  const sessions = all.filter((session) => !hasEnded(session));
  const been = all.length - sessions.length;
  const open = isOpen(offering);

  return (
    <div className="space-y-6">
      <PageHeader
        title={offering.title}
        description={
          offering.teacher?.name
            ? `${scheduleLabel(offering)} · ${priceLabel(offering)} · with ${offering.teacher.name}`
            : `${scheduleLabel(offering)} · ${priceLabel(offering)}`
        }
        actions={
          offering.mayEdit ? (
            <Link href={`/member/${orgSlug}/teaching`} className="btn-secondary">
              Edit
            </Link>
          ) : undefined
        }
      />

      <Link
        href={`/portal/${orgSlug}/teaching`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All teaching
      </Link>

      {error && (
        <Panel>
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        </Panel>
      )}

      {offering.richDescription && (
        <Panel title="About this">
          {/*
            `RichBody` rather than raw innerHTML: it sanitises the same way and
            makes an @mention open the member card every name in MaybeOS opens,
            which a hand-rolled div would quietly not do.
          */}
          <RichBody body={offering.richDescription} className="text-sm text-ink" />
        </Panel>
      )}

      {/* The dates. A workshop's sessions are events, so each links to one. */}
      {offering.kind === 'WORKSHOP' && (
        <Panel
          title="Dates"
          description={
            sessions.length === 0
              ? been > 0
                ? `Nothing coming up. ${been} ${been === 1 ? 'date has' : 'dates have'} already been.`
                : 'None yet. Put your hand up and the teacher will know there is interest.'
              : been > 0
                ? `${been} earlier ${been === 1 ? 'date has' : 'dates have'} already been.`
                : undefined
          }
        >
          {sessions.length > 0 && (
            <ul className="divide-y divide-[var(--border)]">
              {sessions.map((session) => (
                <li key={session.slug} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <Link
                      href={`/portal/${orgSlug}/events/${session.slug}`}
                      className="text-sm font-medium text-ink hover:underline"
                    >
                      {whenLabel(
                        session.startTime,
                        session.endTime,
                        session.timezone ?? timezone,
                      )}
                    </Link>
                    {session.location?.name && (
                      <p className="text-sm text-[var(--text-secondary)]">
                        {session.location.name}
                      </p>
                    )}
                  </div>
                  <Link
                    href={`/portal/${orgSlug}/events/${session.slug}`}
                    className="btn-secondary text-sm"
                  >
                    {session.priceCents ? 'Tickets' : 'RSVP'}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {offering.mayEdit && (
            <div className={sessions.length > 0 ? 'mt-4 border-t border-[var(--border)] pt-4' : ''}>
              <SessionScheduler
                orgId={orgId!}
                offeringId={offering.id}
                token={token!}
                onAdded={load}
              />
            </div>
          )}
        </Panel>
      )}

      {/* Putting your hand up. Not offered to the teacher, who is already in. */}
      {!offering.mayEdit && open && (
        <Panel
          title={offering.kind === 'PRIVATE_LESSON' ? 'Ask about lessons' : 'Register interest'}
          description={
            offering.kind === 'PRIVATE_LESSON'
              ? 'We will let them know, and they will get in touch to arrange a time.'
              : 'The teacher sees who is interested, which is how a date gets chosen.'
          }
        >
          {asked ? (
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <Check className="h-4 w-4 text-green-700" aria-hidden />
              They know. Expect to hear from them.
            </p>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-sm text-[var(--text-secondary)]">
                  Anything they should know? <span className="opacity-70">Optional.</span>
                </span>
                <textarea
                  className="input w-full"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Complete beginner, and Tuesdays are best for me."
                  maxLength={1000}
                />
              </label>
              <button
                type="button"
                className="btn-primary"
                onClick={putHandUp}
                disabled={asking}
              >
                {asking ? 'Sending…' : offering.kind === 'PRIVATE_LESSON' ? 'Ask about lessons' : "I'm interested"}
              </button>
            </div>
          )}
        </Panel>
      )}

      {!open && (
        <Panel>
          <p className="text-sm text-[var(--text-secondary)]">
            This is no longer taking anybody.
          </p>
        </Panel>
      )}

      {/* The teacher's own view. Nobody else is served this. */}
      {offering.mayEdit && <InterestList interest={interest} />}

      {/*
        The conversation, which is the one in #Teaching (CMN-22).

        Charley: "all comments on an event page or teaching page should sync
        to the identical conversation in the Commons. This prevents two places
        with separate conversations about the same event."

        Nothing syncs, because there is nothing to sync from — this is the
        same post and the same comment rows the channel shows, through the
        component the event page uses. A second store kept in step would be a
        second store to disagree.

        On a card like everything else that is not the page headline
        (DESIGN §2a).
      */}
      {token && orgId && (
        <Panel title="Questions about this">
          <Discussion
            orgId={orgId}
            token={token}
            readThread={() => api.teaching.thread(orgId, offering.id, token)}
            startThread={() => api.teaching.startThread(orgId, offering.id, token)}
            privateMessage="This is kept off the lists, so it has no discussion in the Commons."
            placeholder="Ask the teacher a question…"
          />
        </Panel>
      )}
    </div>
  );
}


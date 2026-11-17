'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { GraduationCap, Loader2, Plus, Users } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Panel } from '@/components/layout/panel';
import { api, type Offering, type OfferingInput } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { OfferingForm } from '@/components/teaching/offering-form';
import { AfterSave } from '@/components/teaching/after-save';
import { priceLabel, scheduleLabel } from '@/lib/teaching';

/**
 * What I teach, and who has asked (TCH-01).
 *
 * Under `/member/` rather than `/portal/`, beside Bookings and My events,
 * because this is the "my things" half of the product. What the *community*
 * teaches lives at `/portal/<slug>/teaching` and is a different question.
 *
 * No past/upcoming tabs here and none needed: this lists offerings, which do
 * not have a date to be past. A workshop's dates are events and they are
 * listed on the event screens, which already have the tabs EVT-49 requires.
 */
export default function MyTeachingPage(props: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = use(props.params);
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);
  const user = useAuthStore((s) => s.user);

  const [offerings, setOfferings] = useState<Offering[] | null>(null);
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState<Offering | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /*
    What to say next, and about which offering (TCH-02).

    Held as the offering itself rather than an id, so the panel can speak
    about the dates on it without a second read. Cleared on dismiss and
    whenever the teacher starts writing something else — a prompt about the
    last thing, sitting above the form for the next one, reads as a bug.
  */
  const [justSaved, setJustSaved] = useState<Offering | null>(null);
  const [stage, setStage] = useState<'draft' | 'published'>('draft');

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      setOfferings(await api.teaching.list(orgId, token));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load what you teach.');
      setOfferings([]);
    }
  }, [token, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(body: OfferingInput) {
    if (!token || !orgId) return;
    setBusy(true);
    setError('');
    try {
      if (editing) {
        await api.teaching.update(orgId, editing.id, body, token);
        setJustSaved(null);
      } else {
        const created = await api.teaching.create(orgId, body, token);
        /*
          Only for something new, and only while it is a draft. An edit does
          not need telling what a draft is, and a member who ticked "publish
          immediately" has already answered the question the panel asks.
        */
        setJustSaved(created.isPublished ? null : created);
        setStage('draft');
      }
      setWriting(false);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  async function setPublished(offering: Offering, isPublished: boolean) {
    if (!token || !orgId) return;
    setBusy(true);
    try {
      const saved = await api.teaching.update(
        orgId,
        offering.id,
        { isPublished } as OfferingInput,
        token,
      );
      /*
        Publishing is the moment worth saying something about: it is when the
        dates reach the calendar, and when a room becomes the next thing.
        Unpublishing is a teacher tidying up and needs no advice.
      */
      if (isPublished) {
        setJustSaved(saved);
        setStage('published');
      } else {
        setJustSaved(null);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  /*
    Mine first, then everybody else's.

    The list is the same one the whole co-op sees — one route, one set of
    visibility rules — and this page is about *my* teaching, so the sort does
    the separating rather than a second request.
  */
  const mine = (offerings ?? []).filter(
    (offering) => offering.teacher?.id && offering.teacher.id === user?.id,
  );

  if (writing || editing) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={editing ? 'Edit what you teach' : 'Offer to teach something'}
          description="A workshop has dates, or will have. Private lessons are arranged with each person."
        />
        {/*
          On a card, like every other word that is not the page headline
          (DESIGN §2a). This was bare until TCH-02 added the date rows and
          made it obvious: a co-op picks the colour behind this, and a
          fieldset legend left loose on it is legible or not depending on a
          choice made in a colour picker weeks earlier.

          Still a prose measure, which §1 allows to be narrower than the
          column.
        */}
        <div className="card max-w-3xl">
        <OfferingForm
          existing={editing ?? undefined}
          onSave={save}
          onCancel={() => {
            setWriting(false);
            setEditing(null);
          }}
          busy={busy}
        />
        </div>
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        /*
          Named for the nav item that reaches it (Charley, 2026-11-17). Every
          other screen in My membership does the same — My Events, My
          Bookings, My Service — and a link that says one thing landing on a
          page headed another is how somebody wonders whether they clicked
          the wrong one.
        */
        title="My Teaching"
        description="Run a workshop, or offer private lessons. You decide who can see it."
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setJustSaved(null);
              setWriting(true);
            }}
          >
            <Plus className="mr-1.5 inline h-4 w-4" />
            Offer something
          </button>
        }
      />

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {/*
        What happens next, at the two moments it is worth saying (TCH-02).
        Above the list, because it is about the thing that just changed.
      */}
      {justSaved && (
        <AfterSave
          offering={justSaved}
          stage={stage}
          orgSlug={orgSlug}
          busy={busy}
          onPublish={() => void setPublished(justSaved, true)}
          onDismiss={() => setJustSaved(null)}
        />
      )}

      {offerings === null ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : mine.length === 0 ? (
        <div className="card p-8 text-center">
          <GraduationCap className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-900">
            You have not offered anything yet.
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
            A workshop can go up before it has any dates — put it out there and see who is
            interested first.
          </p>
          <button
            type="button"
            className="btn-secondary mt-4"
            onClick={() => {
              setJustSaved(null);
              setWriting(true);
            }}
          >
            Offer something
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {mine.map((offering) => (
            <MineRow
              key={offering.id}
              offering={offering}
              orgSlug={orgSlug}
              onEdit={() => setEditing(offering)}
              onPublish={(next) => setPublished(offering, next)}
            />
          ))}
        </ul>
      )}

      {(offerings?.length ?? 0) > mine.length && (
        <Panel>
          <Link
            href={`/portal/${orgSlug}/teaching`}
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            See everything the co-op teaches &rarr;
          </Link>
        </Panel>
      )}
    </div>
  );
}

function MineRow({
  offering,
  orgSlug,
  onEdit,
  onPublish,
}: {
  offering: Offering;
  orgSlug: string;
  onEdit: () => void;
  onPublish: (next: boolean) => void;
}) {
  const asked = offering._count?.interests ?? 0;

  return (
    <li className="card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/portal/${orgSlug}/teaching/${offering.slug}`}
              className="font-semibold text-gray-900 hover:underline"
            >
              {offering.title}
            </Link>
            {!offering.isPublished && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                Draft
              </span>
            )}
            {offering.closedAt && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                Closed
              </span>
            )}
          </div>

          {offering.summary && (
            <p className="mt-1 text-sm text-gray-600">{offering.summary}</p>
          )}

          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span>{scheduleLabel(offering)}</span>
            <span aria-hidden>·</span>
            <span>{priceLabel(offering)}</span>
            <span aria-hidden>·</span>
            <span>
              {offering.visibility === 'PUBLIC'
                ? 'Public'
                : offering.visibility === 'MEMBERS_ONLY'
                  ? 'Members only'
                  : 'Unlisted'}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/*
            How many people have asked, as the same red badge the nav uses for
            anything else somebody has to deal with. Zero is not a badge.
          */}
          {asked > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
              <Users className="h-3 w-3" />
              {asked} asked
            </span>
          )}
          <button type="button" onClick={onEdit} className="btn-secondary text-xs">
            Edit
          </button>
          <button
            type="button"
            onClick={() => onPublish(!offering.isPublished)}
            className="btn-secondary text-xs"
          >
            {offering.isPublished ? 'Unpublish' : 'Publish'}
          </button>
        </div>
      </div>
    </li>
  );
}


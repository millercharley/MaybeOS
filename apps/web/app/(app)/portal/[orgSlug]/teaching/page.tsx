'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { GraduationCap, Loader2, Search } from 'lucide-react';
import { api, type Offering } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { PageHeader } from '@/components/layout/page-header';
import { Panel } from '@/components/layout/panel';
import { OfferingCard } from '@/components/teaching/offering-card';
import { isOpen } from '@/lib/teaching';

/**
 * Everything this community teaches (TCH-01).
 *
 * The standalone page Charley asked for: "Everything being taught or offered
 * should show on a standalone page to list all offerings in the community."
 *
 * In the portal, beside Commons, Members and Events, because this is a
 * community surface. The member's own list — what *they* teach, and who has
 * asked — is at `/member/<slug>/teaching` and answers a different question.
 *
 * **Two tabs, and not the EVT-49 ones.** This lists offerings, which have no
 * date to be past, so "upcoming" and "finished" would be meaningless. The
 * split that does mean something is workshops against private lessons: they
 * are different kinds of thing and somebody arrives wanting one or the other.
 * A workshop's *dates* are events and live on the event screens, which carry
 * the past/upcoming tabs that rule is about.
 */
export default function CommunityTeachingPage(props: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = use(props.params);
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [offerings, setOfferings] = useState<Offering[] | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'WORKSHOP' | 'PRIVATE_LESSON'>('WORKSHOP');
  const [find, setFind] = useState('');

  useEffect(() => {
    if (!token || !orgId) return;
    let live = true;

    api.teaching
      .list(orgId, token)
      .then((rows) => {
        if (live) {
          setOfferings(rows);
          setError('');
        }
      })
      .catch((err) => {
        if (!live) return;
        /*
          "Nothing here" and "we could not ask" are different, and the
          difference is the one thing the reader needs (DESIGN §7). A silent
          catch rendering the empty state would say the co-op teaches nothing.
        */
        setError(err instanceof Error ? err.message : 'Could not load what the co-op teaches.');
        setOfferings([]);
      });

    return () => {
      live = false;
    };
  }, [token, orgId]);

  /*
    Split by kind first, then search inside the tab — the same order the
    transfer list uses (EVT-52). The other way round would let a search in
    Workshops quietly answer with a private lesson, which is the one thing
    the tabs exist to stop.
  */
  const { workshops, lessons } = useMemo(() => {
    const open = (offerings ?? []).filter(isOpen);
    return {
      workshops: open.filter((o) => o.kind === 'WORKSHOP'),
      lessons: open.filter((o) => o.kind === 'PRIVATE_LESSON'),
    };
  }, [offerings]);

  const shown = useMemo(() => {
    const inTab = tab === 'WORKSHOP' ? workshops : lessons;
    const needle = find.trim().toLowerCase();
    if (!needle) return inTab;

    return inTab.filter((offering) =>
      [offering.title, offering.summary, offering.teacher?.name]
        .some((field) => (field ?? '').toLowerCase().includes(needle)),
    );
  }, [tab, workshops, lessons, find]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teaching"
        description="Workshops and lessons offered by people here."
        actions={
          <Link href={`/member/${orgSlug}/teaching`} className="btn-primary">
            Offer something
          </Link>
        }
      />

      {error && (
        <Panel>
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        </Panel>
      )}

      <Panel bodyClassName="">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1" role="tablist" aria-label="What kind">
            <Tab
              chosen={tab === 'WORKSHOP'}
              onChoose={() => setTab('WORKSHOP')}
              label="Workshops"
              count={workshops.length}
            />
            <Tab
              chosen={tab === 'PRIVATE_LESSON'}
              onChoose={() => setTab('PRIVATE_LESSON')}
              label="Private lessons"
              count={lessons.length}
            />
          </div>

          <label className="relative min-w-0 flex-1 sm:max-w-xs">
            <span className="sr-only">Search what the co-op teaches</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]"
              aria-hidden
            />
            <input
              className="input w-full pl-9"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Search by title, person or subject"
            />
          </label>
        </div>
      </Panel>

      {offerings === null ? (
        <Panel>
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" />
          </div>
        </Panel>
      ) : shown.length === 0 ? (
        <Panel>
          <div className="py-8 text-center">
            <GraduationCap className="mx-auto h-8 w-8 text-[var(--text-tertiary)]" />
            <p className="mt-3 text-sm font-semibold text-ink">
              {find.trim()
                ? 'Nothing matches that.'
                : tab === 'WORKSHOP'
                  ? 'No workshops yet.'
                  : 'Nobody is offering lessons yet.'}
            </p>
            {!find.trim() && (
              <p className="mx-auto mt-1 max-w-md text-sm text-[var(--text-secondary)]">
                If you teach something, you can put it here — a workshop can go up before it
                has any dates.
              </p>
            )}
          </div>
        </Panel>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((offering) => (
            <li key={offering.id} className="min-w-0">
              <OfferingCard
                offering={offering}
                href={`/portal/${orgSlug}/teaching/${offering.slug}`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Tab({
  chosen,
  onChoose,
  label,
  count,
}: {
  chosen: boolean;
  onChoose: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={chosen}
      onClick={onChoose}
      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
        chosen
          ? 'bg-ink text-paper'
          : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]'
      }`}
    >
      {label}
      <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
    </button>
  );
}

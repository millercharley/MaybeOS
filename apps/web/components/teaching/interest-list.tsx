'use client';

import { Loader2, Users } from 'lucide-react';
import { Panel } from '@/components/layout/panel';
import { timeAgo } from '@/lib/relative-time';
import type { OfferingInterest } from '@/lib/api';

/**
 * Who has put their hand up (TCH-01).
 *
 * Served only to the teacher, whoever wrote the offering up, and the co-op's
 * organisers — the API refuses everybody else, so this component is not even
 * rendered for them.
 *
 * **The notes are the point.** "Complete beginner", "Tuesdays are best",
 * "money is tight this month" — a learner wrote that to this person, and the
 * list exists so they can read it and reply. It is why MaybeOS collects an
 * enquiry instead of printing an email address on a page: neither party's
 * address is published, and the teacher still gets everything they need to
 * answer.
 *
 * No "mark as handled" control yet. The column is there for it, but a button
 * whose only effect is to grey a row out is a feature somebody has to be
 * taught; it waits until a teacher with a long list asks for it.
 */
export function InterestList({ interest }: { interest: OfferingInterest[] | null }) {
  if (interest === null) {
    return (
      <Panel title="Who has asked">
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
        </div>
      </Panel>
    );
  }

  if (interest.length === 0) {
    return (
      <Panel title="Who has asked">
        <p className="text-sm text-[var(--text-secondary)]">
          Nobody yet. They will show up here, with anything they wanted you to know.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Who has asked"
      description={`${interest.length} ${interest.length === 1 ? 'person' : 'people'}. Only you and the organisers can see this.`}
    >
      <ul className="divide-y divide-[var(--border)]">
        {interest.map((entry) => (
          <li key={entry.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            {entry.user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={entry.user.avatarUrl}
                alt=""
                className="h-8 w-8 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700"
                aria-hidden
              >
                {(entry.user.name ?? '?').charAt(0).toUpperCase()}
              </span>
            )}

            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-ink">
                  {entry.user.name ?? 'Somebody'}
                </span>
                <span className="text-sm text-[var(--text-tertiary)]">
                  {timeAgo(entry.createdAt)}
                </span>
              </p>
              {entry.note && (
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{entry.note}</p>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-4 flex items-start gap-2 text-sm text-[var(--text-tertiary)]">
        <Users className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Message them from the Members page to arrange things. We have not given them your
        email address, and we have not given you theirs.
      </p>
    </Panel>
  );
}

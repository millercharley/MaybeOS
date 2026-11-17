'use client';

import Link from 'next/link';
import { CalendarDays, GraduationCap, Users } from 'lucide-react';
import type { Offering } from '@/lib/api';
import { actionLabel, isOpen, priceLabel, scheduleLabel } from '@/lib/teaching';

/**
 * One offering, as a card (TCH-01).
 *
 * Shared by the community page, the member's own list and the public page, so
 * the same thing looks the same in all three — which is the whole point of
 * DESIGN.md's first paragraph. The differences between those screens are
 * about *which* offerings they hold, not how one looks.
 *
 * `href` rather than an `onClick`, because a card for a thing with its own
 * address should be a link: middle-click, copy-link and open-in-new-tab are
 * all free, and a visitor on the public page may well want to send one to
 * somebody.
 */
export function OfferingCard({
  offering,
  href,
  showTeacher = true,
}: {
  offering: Offering;
  href: string;
  /** Off on a teacher's own list, where every card would say the same name. */
  showTeacher?: boolean;
}) {
  const open = isOpen(offering);

  return (
    <Link
      href={href}
      className={`card block transition-shadow hover:shadow-md ${open ? '' : 'opacity-70'}`}
    >
      {offering.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={offering.imageUrl}
          alt=""
          className="mb-3 h-32 w-full rounded-lg object-cover"
          style={{ objectPosition: `50% ${offering.imageFocusY ?? 50}%` }}
        />
      )}

      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 shrink-0 text-[var(--text-tertiary)]"
          aria-hidden
          title={offering.kind === 'WORKSHOP' ? 'A workshop' : 'Private lessons'}
        >
          {offering.kind === 'WORKSHOP' ? (
            <Users className="h-4 w-4" />
          ) : (
            <GraduationCap className="h-4 w-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink">{offering.title}</h3>

          {showTeacher && offering.teacher?.name && (
            <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
              with {offering.teacher.name}
            </p>
          )}

          {offering.summary && (
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{offering.summary}</p>
          )}

          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--text-tertiary)]">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {scheduleLabel(offering)}
            </span>
            <span aria-hidden>·</span>
            <span>{priceLabel(offering)}</span>
          </p>

          {/*
            Not a button: the whole card is the link, and a button inside a
            link is a control inside a control — which browsers render and
            screen readers announce in ways nobody intends. The words still
            earn their place by saying what happens next.
          */}
          <p className="mt-3 text-sm font-medium text-brand-600">{actionLabel(offering)}</p>
        </div>
      </div>
    </Link>
  );
}

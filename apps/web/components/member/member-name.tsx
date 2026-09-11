'use client';

import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useMemberCard } from '@/contexts/member-card-context';

/**
 * A person's name that opens their card (MEM-18).
 *
 * A `span` with button semantics rather than a `<button>`, because names sit
 * inside rows that are already buttons and links — a post header, a door-list
 * row, a table cell — and a button nested in a button is invalid HTML the
 * browser repairs by closing the outer one. The click stops here, so opening
 * a card never also checks somebody in or follows the row's link.
 *
 * Without a user id (a walk-in, a deleted account) it is just the name.
 */
export function MemberName({
  userId,
  name,
  className = '',
  children,
}: {
  userId?: string | null;
  name?: string | null;
  className?: string;
  children?: ReactNode;
}) {
  const { openMember } = useMemberCard();
  const label = children ?? name ?? 'Member';

  if (!userId) return <span className={className}>{label}</span>;

  const open = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openMember({ userId, name });
  };

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') open(e);
      }}
      className={`cursor-pointer hover:underline focus:outline-none focus-visible:underline ${className}`}
    >
      {label}
    </span>
  );
}

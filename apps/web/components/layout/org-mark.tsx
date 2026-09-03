'use client';

/* eslint-disable @next/next/no-img-element */

import { useState } from 'react';

/**
 * The co-op's own logo, in the header of the pages its members use (BRD-01).
 *
 * Uploaded on Settings → Branding since OPS-03c and shown, until now, only on
 * the Settings page that uploaded it. Charley: it "should appear small in the
 * Header of all member pages, perhaps set justified right."
 *
 * Right, and small: this is a co-op saying *this is ours* on their own
 * members' pages, not a masthead. The MaybeOS wordmark stays in the sidebar,
 * so the two marks never compete for the same corner.
 *
 * Nothing renders when a co-op has no logo — an empty box or a letter in a
 * circle would be MaybeOS inventing a mark for somebody, which the wordmark
 * rule already forbids for MaybeOS's own.
 */
export function OrgMark({ name, logoUrl }: { name?: string | null; logoUrl?: string | null }) {
  // A logo whose URL has rotted — a moved bucket, a deleted object — would
  // otherwise put a broken-image icon in the header of every page a member
  // opens. Nothing is better than that.
  const [broken, setBroken] = useState(false);

  if (!logoUrl || broken) return null;

  return (
    <img
      src={logoUrl}
      onError={() => setBroken(true)}
      // Named rather than decorative: on a co-op's own pages this is the one
      // thing telling a member whose space they are in.
      alt={name ? `${name} logo` : 'Co-op logo'}
      className="h-7 w-auto max-w-[9rem] shrink-0 object-contain"
    />
  );
}

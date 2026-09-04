'use client';

import { useState } from 'react';
import { Copy, Check, ExternalLink, AlertTriangle } from 'lucide-react';
import { Org } from '@/lib/api';

/**
 * The co-op's own page on MaybeOS, handed to the admin (PUB-01).
 *
 * Charley, 2026-09-05: "Missing is a way for an admin to get an embed for
 * their website OR offer a landing page for people to come, pick a tier of
 * membership, and become a member."
 *
 * The landing page had existed since the beginning — `/orgs/<slug>`, mission,
 * tiers, Join buttons, upcoming events — and **nothing anywhere in the admin
 * mentioned it or its address.** A feature nobody can find is not a feature,
 * so this card is mostly a URL, a copy button and a sentence about what a
 * visitor sees.
 *
 * It also says the thing the page itself cannot: an invitation-only co-op's
 * page shows the tiers but offers no way in, and an admin who has just copied
 * the link should learn that here rather than from a member who couldn't join.
 */
export function JoinPage({ org, allowPublicJoin }: { org: Org; allowPublicJoin: boolean }) {
  const [copied, setCopied] = useState(false);

  // Whatever host this app is served from, so a staging copy never hands out a
  // production link.
  const origin = typeof window === 'undefined' ? 'https://maybeos.org' : window.location.origin;
  const url = `${origin}/orgs/${org.slug}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the link is selectable either way.
      setCopied(false);
    }
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Your join page</h2>
        <p className="mt-1 text-sm text-gray-500">
          Every co-op on MaybeOS has one. Share this link anywhere — social, a newsletter, a
          poster — and whoever opens it sees your mission, your membership tiers and your next
          few public events, then picks a tier and joins.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800">
          {url}
        </code>
        <button
          type="button"
          onClick={copy}
          className="btn-primary inline-flex items-center gap-2 text-sm"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary inline-flex items-center gap-2 text-sm"
        >
          <ExternalLink className="h-4 w-4" />
          Open
        </a>
      </div>

      {!allowPublicJoin && (
        <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-medium text-amber-900">Nobody can join from it yet.</p>
            <p className="mt-1 text-amber-800">
              {org.name} is invitation only, so the page shows your tiers and prices but has no
              Join buttons — a visitor can read it and then has to write to you. Open the doors
              in <b>Who can join</b>, below, if you want the link to do the joining.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

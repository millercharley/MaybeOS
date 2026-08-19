'use client';

import { useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { Org } from '@/lib/api';

/**
 * The co-op's events, on the co-op's own website.
 *
 * Charley, 2026-08-19, pointing at eventscalendar.co on maybeitsfate.com: an
 * admin should be able to paste one block into Webflow, Squarespace or
 * WordPress and have their MaybeOS events appear, staying in step by
 * themselves.
 *
 * The snippet is a single script tag on purpose. Site builders offer an
 * "embed" block that accepts a script, and fight anything more elaborate —
 * and one line is something an organiser can paste without a developer.
 */
export function WebsiteEmbed({ org }: { org: Org }) {
  const [copied, setCopied] = useState(false);

  // Whatever host this app is served from, so a staging copy never hands out a
  // production snippet.
  const origin = typeof window === 'undefined' ? 'https://maybeos.org' : window.location.origin;
  const snippet = `<script src="${origin}/embed.js" data-org="${org.slug}" defer></script>`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the snippet is selectable either way.
      setCopied(false);
    }
  }

  return (
    <section className="card max-w-2xl space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Your events on your website</h2>
        <p className="mt-1 text-sm text-gray-500">
          Paste this into an embed or custom-code block on your own site. Your public events
          appear there and stay in step on their own — there is nothing to update when you add
          an event.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <code className="block break-all font-mono text-xs text-gray-800">{snippet}</code>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={copy} className="btn-primary inline-flex items-center gap-2 text-sm">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy embed code'}
        </button>
        <a
          href={`/portal/${org.slug}/events`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          See what it will show
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="border-t border-gray-100 pt-3 text-xs text-gray-500">
        <p>
          <span className="font-medium text-gray-700">Only public events appear.</span> Anything
          members-only or private stays off your website, and a draft stays off until you publish
          it.
        </p>
        <p className="mt-2">
          Optional: add <code className="font-mono">data-limit=&quot;5&quot;</code> to show fewer,
          or <code className="font-mono">data-accent=&quot;#b03030&quot;</code> to match your
          site&apos;s colour.
        </p>
      </div>
    </section>
  );
}

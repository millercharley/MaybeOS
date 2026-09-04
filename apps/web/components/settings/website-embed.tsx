'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Org } from '@/lib/api';
import { DEFAULT_ACCENT, embedSnippet, normaliseHex } from '@/lib/embed-snippet';

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
  const [accentInput, setAccentInput] = useState(DEFAULT_ACCENT);

  const accent = normaliseHex(accentInput);
  const invalid = accentInput.trim() !== '' && accent === null;

  // Whatever host this app is served from, so a staging copy never hands out a
  // production snippet.
  const origin = typeof window === 'undefined' ? 'https://maybeos.org' : window.location.origin;

  const snippet = embedSnippet(origin, org.slug, accentInput);

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
    <section className="card space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Your events on your website</h2>
        <p className="mt-1 text-sm text-gray-500">
          Paste this into an embed or custom-code block on your own site. Your public events
          for the next 30 days appear there and stay in step on their own — there is nothing
          to update when you add an event.
        </p>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Accent color</span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {/* Two ways in, one value: the picker for people who want to see the
              colour, the text field for people who have a brand hex to paste. */}
          <input
            type="color"
            aria-label="Pick an accent color"
            className="h-9 w-12 cursor-pointer rounded border border-gray-200 bg-white p-1"
            value={accent ?? DEFAULT_ACCENT}
            onChange={(e) => setAccentInput(e.target.value)}
          />
          <input
            type="text"
            className="input w-36 font-mono"
            spellCheck={false}
            placeholder={DEFAULT_ACCENT}
            value={accentInput}
            onChange={(e) => setAccentInput(e.target.value)}
          />
          {accentInput.trim() !== DEFAULT_ACCENT && (
            <button
              type="button"
              onClick={() => setAccentInput(DEFAULT_ACCENT)}
              className="btn-ghost text-xs"
            >
              Reset
            </button>
          )}
        </div>
        <span className="mt-1 block text-xs text-gray-500">
          {invalid
            ? 'That is not a color yet — use a hex like #b03030.'
            : 'Used for event dates and ticket prices in the embed. Match your own site.'}
        </span>
      </label>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <code className="block break-all font-mono text-xs text-gray-800">{snippet}</code>
      </div>

      <button
        type="button"
        onClick={copy}
        disabled={invalid}
        className="btn-primary inline-flex items-center gap-2 text-sm"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? 'Copied' : 'Copy embed code'}
      </button>

      <EmbedPreview origin={origin} slug={org.slug} accent={accent ?? DEFAULT_ACCENT} />

      <div className="border-t border-gray-100 pt-3 text-xs text-gray-500">
        <p>
          <span className="font-medium text-gray-700">Only public events appear.</span> Anything
          members-only or private stays off your website, and a draft stays off until you publish
          it.
        </p>
      </div>
    </section>
  );
}

/**
 * The embed, actually running.
 *
 * This used to be a link to the portal's events page, which is a different
 * page with a different design — so "See what it will show" showed something
 * else. It now loads the real `embed.js` against the real feed, which is the
 * only preview that cannot drift from what a visitor gets.
 *
 * The script is re-inserted whenever the accent changes: `embed.js` reads its
 * attributes once, at execution, and a live-updating preview would mean two
 * implementations of the same rendering.
 */
function EmbedPreview({
  origin,
  slug,
  accent,
}: {
  origin: string;
  slug: string;
  accent: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = holder.current;
    if (!node) return;

    node.replaceChildren();
    setFailed(false);

    const script = document.createElement('script');
    script.src = `${origin}/embed.js`;
    script.setAttribute('data-org', slug);
    script.setAttribute('data-accent', accent);
    script.onerror = () => setFailed(true);
    node.appendChild(script);

    return () => node.replaceChildren();
  }, [origin, slug, accent]);

  return (
    <div>
      <p className="text-sm font-medium text-gray-700">What it will show</p>
      <p className="mt-0.5 text-xs text-gray-500">
        This is the embed itself, running against your live events — not a picture of it.
      </p>
      <div className="mt-2 rounded-lg border border-dashed border-gray-300 bg-white p-4">
        {failed ? (
          <p className="text-sm text-gray-500">
            The embed script could not be loaded from {origin}.
          </p>
        ) : (
          <div ref={holder} />
        )}
      </div>
    </div>
  );
}

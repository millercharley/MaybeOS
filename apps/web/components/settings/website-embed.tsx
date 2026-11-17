'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, Check } from 'lucide-react';
import { Org } from '@/lib/api';
import { EmbedShow, embedSnippet, normaliseHex, resolveAccent } from '@/lib/embed-snippet';

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
 *
 * Three of these now (PUB-01, TCH-01): the events list, the membership tiers
 * with Join buttons that land on `/join`, and what the co-op teaches. Same
 * card, same preview, same script — only the copy and one attribute differ,
 * and a co-op that wants all three pastes all three tags.
 *
 * The copy is a lookup rather than nested ternaries. It was two branches and
 * read fine; at three it would be the shape where somebody adds a fourth and
 * only remembers two of the places.
 */
const COPY: Record<EmbedShow, { heading: string; blurb: string; note: ReactNode; previewing: string }> = {
  events: {
    heading: 'Your events on your website',
    blurb:
      'Paste this into an embed or custom-code block on your own site. Your public events for the next 30 days appear there and stay in step on their own — there is nothing to update when you add an event.',
    previewing: 'events',
    note: (
      <p>
        <span className="font-medium text-gray-700">Only public events appear.</span> Anything
        members-only or private stays off your website, and a draft stays off until you publish
        it.
      </p>
    ),
  },
  membership: {
    heading: 'Membership on your website',
    blurb:
      'Paste this into an embed or custom-code block on your own site. Your tiers appear there with a Join button on each one, and stay in step on their own — change a price here and the website follows.',
    previewing: 'tiers',
    note: (
      <p>
        <span className="font-medium text-gray-700">Joining opens on MaybeOS.</span> The buttons
        open your join page in a new tab, so your visitor keeps your site — and payment happens
        on Stripe, never on your website. Deactivated tiers never appear.
      </p>
    ),
  },
  teaching: {
    heading: 'What your members teach, on your website',
    blurb:
      'Paste this into an embed or custom-code block on your own site. Workshops and private lessons your members have made public appear there, and stay in step on their own.',
    previewing: 'workshops and lessons',
    note: (
      <p>
        <span className="font-medium text-gray-700">Only public offerings appear.</span> Anything
        a member kept to the co-op stays off your website, and so does a draft. A workshop shows
        its next date, or says it has none yet.
      </p>
    ),
  },
};

export function WebsiteEmbed({ org, show = 'events' }: { org: Org; show?: EmbedShow }) {
  // `words` not `copy`: this card already has a copy-to-clipboard handler.
  const words = COPY[show];
  const [copied, setCopied] = useState(false);
  // Seeded from Branding, not from MaybeOS's red (BRD-03). This field used to
  // open on #b03030, so a co-op that had already chosen a colour had to type
  // it again here — twice, once this card became two — and the value they saw
  // on their own website was ours until they did.
  const brandAccent = resolveAccent(org.brandColor);
  const [accentInput, setAccentInput] = useState(brandAccent);

  // Follow Branding when it changes. The accent is not stored anywhere — it
  // only shapes the snippet on screen — so there is no override worth keeping
  // across an edit to the colour it is supposed to inherit.
  useEffect(() => {
    setAccentInput(brandAccent);
  }, [brandAccent]);

  const accent = normaliseHex(accentInput);
  const invalid = accentInput.trim() !== '' && accent === null;

  // Whatever host this app is served from, so a staging copy never hands out a
  // production snippet.
  const origin = typeof window === 'undefined' ? 'https://maybeos.org' : window.location.origin;

  const snippet = embedSnippet(origin, org.slug, accentInput, show);

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
        <h2 className="text-base font-semibold text-gray-900">
          {words.heading}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {words.blurb}
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
            value={accent ?? brandAccent}
            onChange={(e) => setAccentInput(e.target.value)}
          />
          <input
            type="text"
            className="input w-36 font-mono"
            spellCheck={false}
            placeholder={brandAccent}
            value={accentInput}
            onChange={(e) => setAccentInput(e.target.value)}
          />
          {accentInput.trim() !== brandAccent && (
            <button
              type="button"
              onClick={() => setAccentInput(brandAccent)}
              className="btn-ghost text-xs"
            >
              Use brand color
            </button>
          )}
        </div>
        <span className="mt-1 block text-xs text-gray-500">
          {invalid
            ? 'That is not a color yet — use a hex like #b03030.'
            : 'Starts from your brand color, set in Branding. Change it here only if this embed should look different from the rest of your co-op.'}
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

      <EmbedPreview origin={origin} slug={org.slug} accent={accent ?? brandAccent} show={show} />

      <div className="border-t border-gray-100 pt-3 text-xs text-gray-500">
        {words.note}
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
  show,
}: {
  origin: string;
  slug: string;
  accent: string;
  show: EmbedShow;
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
    // Anything but events carries the attribute; events is the absence of
    // it, which is what every tag pasted before PUB-01 looks like.
    if (show !== 'events') script.setAttribute('data-show', show);
    script.onerror = () => setFailed(true);
    node.appendChild(script);

    return () => node.replaceChildren();
  }, [origin, slug, accent, show]);

  return (
    <div>
      <p className="text-sm font-medium text-gray-700">What it will show</p>
      <p className="mt-0.5 text-xs text-gray-500">
        This is the embed itself, running against your live{' '}
        {COPY[show].previewing} — not a picture of it.
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

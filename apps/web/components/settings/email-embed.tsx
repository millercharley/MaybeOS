'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Check, RefreshCw } from 'lucide-react';
import { Org } from '@/lib/api';

/**
 * The co-op's events, inside an email campaign (EVT-55).
 *
 * Charley pasted the website embed into MailerLite and got nothing, which is
 * what a `<script>` tag does in an email: every client strips it. So this is
 * the same events by a second route — an RSS feed whose one item carries the
 * whole laid-out block, which is the shape a campaign tool knows how to drop
 * into a template.
 *
 * A URL rather than a snippet, which is the difference worth making obvious
 * on this page. The card above hands over markup to paste into a page; this
 * hands over an address to paste into a campaign's feed field, and pasting
 * either one into the other's box is the mistake it is here to prevent.
 */
export function EmailEmbed({ org }: { org: Org }) {
  const [copied, setCopied] = useState(false);

  // Whatever host this app is served from, so a staging copy never hands out
  // a production feed.
  const origin = typeof window === 'undefined' ? 'https://maybeos.org' : window.location.origin;
  const feedUrl = `${origin}/api/embed/${org.slug}/rss`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the address is selectable either way.
      setCopied(false);
    }
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Your events in an email</h2>
        <p className="mt-1 text-sm text-gray-500">
          The embed above is a script, and email clients strip scripts — so it shows nothing in a
          campaign. Give your email tool this address instead. It is an RSS feed: your events
          arrive already laid out, and the next send picks up whatever has changed.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <code className="block break-all font-mono text-xs text-gray-800">{feedUrl}</code>
      </div>

      <button
        type="button"
        onClick={copy}
        className="btn-primary inline-flex items-center gap-2 text-sm"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? 'Copied' : 'Copy feed address'}
      </button>

      <EmailPreview feedUrl={feedUrl} />

      <div className="space-y-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
        <p>
          <span className="font-medium text-gray-700">In MailerLite</span>, start an RSS campaign
          and paste this as the feed. Most tools call it an RSS or auto-feed campaign; some ask
          for the item content, which is where the block lands.
        </p>
        <p>
          <span className="font-medium text-gray-700">Only public events appear</span> — anything
          members-only or private stays out, and a draft stays out until you publish it. Nobody&rsquo;s
          name or face is in it, because an email gets forwarded.
        </p>
        <p>
          <span className="font-medium text-gray-700">
            If your tool restyles it, paste the HTML instead.
          </span>{' '}
          MailerLite&rsquo;s RSS block normalises whatever it is given — it strips inline styles,
          stretches any image to the column width and repaints backgrounds in its own palette — so
          the layout cannot survive it. Use <em>Copy HTML</em> above and paste that into a custom
          HTML block, where nothing is rewritten. The trade is that an HTML block is a snapshot:
          it will not update itself, so paste it again when you next send.
        </p>
        <p>
          <span className="font-medium text-gray-700">Send yourself a test first.</span> Email
          clients disagree about almost everything, and Outlook on Windows is the one worth
          checking.
        </p>
      </div>
    </section>
  );
}

/**
 * The block itself, fetched from the live feed.
 *
 * Fetches the real RSS and renders the real item — the same bytes the
 * campaign tool will read — rather than re-rendering the layout here. A
 * preview built from a second implementation is a preview that can disagree
 * with what gets sent, which is the failure this is supposed to catch.
 *
 * In an `<iframe srcdoc>` for two reasons. The honest one: email HTML carries
 * its own styles on every element and sits in a 600px world, so showing it
 * inside the admin's own stylesheet would show something neither accurate nor
 * email-like. The careful one: this markup is assembled from event titles and
 * descriptions members wrote, and a sandboxed frame renders it without
 * handing it the admin page.
 */
function EmailPreview({ feedUrl }: { feedUrl: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copiedHtml, setCopiedHtml] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  /**
   * The rendered block, for pasting into a custom HTML block (EVT-59).
   *
   * The feed URL above is the auto-updating route and is the right default.
   * This is the escape hatch for a campaign tool that normalises what it is
   * given — MailerLite's RSS block strips every inline style, resizes any
   * image to the column width and repaints backgrounds in its own palette,
   * so the design cannot survive it however the markup is written. Pasted
   * into a custom HTML block instead, nothing is rewritten and it looks like
   * the website embed.
   *
   * The trade is in the wording below rather than hidden: this is a snapshot,
   * and a snapshot does not update itself.
   */
  const copyHtml = async () => {
    if (!html) return;
    try {
      await navigator.clipboard.writeText(html);
      setCopiedHtml(true);
      setTimeout(() => setCopiedHtml(false), 2000);
    } catch {
      setCopiedHtml(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // `cache: 'no-store'`, because the feed is cached for five minutes at
      // the edge and an organiser pressing Refresh after an edit means it.
      const res = await fetch(feedUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`The feed answered ${res.status}.`);

      const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('The feed is not valid XML.');

      const block = doc.querySelector('item > description')?.textContent ?? '';
      if (!block.trim()) throw new Error('The feed carried no events.');
      setHtml(block);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The feed could not be read.');
      setHtml(null);
    } finally {
      setLoading(false);
    }
  }, [feedUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    The frame grows to its content, because an email has no scrollbar — a
    fixed height would show a window onto the list rather than the list.
    Measured after each render, and on the images loading, which is when the
    height actually settles.
  */
  const fit = useCallback(() => {
    const el = frame.current;
    const body = el?.contentDocument?.body;
    if (el && body) el.style.height = `${body.scrollHeight + 8}px`;
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-700">What the email will show</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Read from the feed itself, so this is the markup your campaign receives — not a
            drawing of it.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void copyHtml()}
            disabled={!html}
            className="btn-ghost inline-flex items-center gap-1.5 text-xs"
          >
            {copiedHtml ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedHtml ? 'Copied' : 'Copy HTML'}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="btn-ghost inline-flex items-center gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-2 overflow-hidden rounded-lg border border-dashed border-gray-300 bg-[#faf9f7] p-4">
        {error ? (
          <p className="text-sm text-gray-500">{error}</p>
        ) : loading && !html ? (
          <p className="text-sm text-gray-500">Reading the feed…</p>
        ) : (
          <iframe
            ref={frame}
            title="Email preview"
            // No scripts, and nothing that could reach this page. The block
            // is ours, but it is assembled from text members wrote.
            sandbox=""
            onLoad={fit}
            srcDoc={`<!doctype html><meta charset="utf-8"><base target="_blank"><body style="margin:0;background:#faf9f7;">${html ?? ''}</body>`}
            className="block w-full border-0 bg-transparent"
            style={{ height: 480 }}
          />
        )}
      </div>
    </div>
  );
}

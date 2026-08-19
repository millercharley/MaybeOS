/**
 * MaybeOS website embed — a co-op's public events, on their own website.
 *
 * One script tag, no build step, no framework, no iframe:
 *
 *   <script src="https://maybeos.org/embed.js" data-org="your-slug" defer></script>
 *
 * Renders where the tag sits. Modelled on how eventscalendar.co does it, for
 * the same reasons:
 *
 *   - **Shadow DOM, not an iframe.** An iframe cannot size itself to its
 *     content, so it either scrolls internally or leaves a gap. A shadow root
 *     gets the same style isolation while flowing with the page — the host
 *     site's CSS cannot reach in, and these styles cannot leak out.
 *   - **A script tag, not a snippet of markup.** Site builders let people paste
 *     an embed block but fight them over markup; one tag survives that.
 *
 * Deliberately vanilla and dependency-free: this runs on somebody else's
 * website, where a framework we chose is a framework they did not.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  var slug = script.getAttribute('data-org');
  var limit = parseInt(script.getAttribute('data-limit') || '10', 10);
  var accent = script.getAttribute('data-accent') || '#b03030';

  // The API lives wherever this script was served from, so a co-op never
  // configures a hostname and staging never points at production by accident.
  var origin = new URL(script.src, window.location.href).origin;

  var host = document.createElement('div');
  script.parentNode.insertBefore(host, script);

  if (!slug) {
    host.textContent = 'MaybeOS embed: add data-org="your-co-op-slug" to the script tag.';
    return;
  }

  var root = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = [
    ':host { all: initial; }',
    '* { box-sizing: border-box; }',
    '.wrap { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; }',
    '.event { display: flex; gap: 16px; padding: 16px 0; border-bottom: 1px solid #e2e2e2; align-items: baseline; }',
    '.event:last-child { border-bottom: 0; }',
    '.when { flex: 0 0 7.5rem; font-size: 13px; color: #666; font-variant-numeric: tabular-nums; }',
    '.body { min-width: 0; flex: 1; }',
    '.title { font-weight: 600; }',
    '.meta { margin-top: 2px; font-size: 13px; color: #666; }',
    '.price { display: inline-block; margin-left: 8px; font-size: 12px; font-weight: 600; color: ' + accent + '; }',
    '.empty, .failed { padding: 24px 0; color: #666; font-size: 14px; }',
    '@media (max-width: 30rem) { .event { display: block; } .when { margin-bottom: 4px; } }',
  ].join('\n');
  root.appendChild(style);

  var wrap = document.createElement('div');
  wrap.className = 'wrap';
  root.appendChild(wrap);

  var money = function (cents, currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: (currency || 'usd').toUpperCase(),
      }).format(cents / 100);
    } catch {
      return '$' + (cents / 100).toFixed(2);
    }
  };

  var when = function (iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };

  // textContent throughout rather than innerHTML: this renders a co-op's own
  // text onto their website, and building markup from strings is how an event
  // title becomes script on somebody else's domain.
  var line = function (event) {
    var row = document.createElement('div');
    row.className = 'event';

    var w = document.createElement('div');
    w.className = 'when';
    w.textContent = when(event.startTime);
    row.appendChild(w);

    var body = document.createElement('div');
    body.className = 'body';

    var title = document.createElement('div');
    title.className = 'title';
    title.textContent = event.title;
    if (event.priceCents) {
      var price = document.createElement('span');
      price.className = 'price';
      price.textContent = money(event.priceCents, event.currency);
      title.appendChild(price);
    }
    body.appendChild(title);

    if (event.location) {
      var meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = event.location;
      body.appendChild(meta);
    }

    row.appendChild(body);
    return row;
  };

  fetch(origin + '/api/embed/' + encodeURIComponent(slug) + '/events')
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      var events = (data.events || []).slice(0, limit);

      if (!events.length) {
        var empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No upcoming events.';
        wrap.appendChild(empty);
        return;
      }

      events.forEach(function (event) {
        wrap.appendChild(line(event));
      });
    })
    .catch(function () {
      // Quiet on a co-op's marketing site: a stack trace where the events
      // should be is worse than a line of text, and the visitor can do nothing
      // with either.
      var failed = document.createElement('div');
      failed.className = 'failed';
      failed.textContent = 'Events are unavailable right now.';
      wrap.appendChild(failed);
    });
})();

/**
 * MaybeOS website embed — a co-op's events or membership, on their own site.
 *
 * One script tag, no build step, no framework, no iframe:
 *
 *   <script src="https://maybeos.org/embed.js" data-org="your-slug" defer></script>
 *   <script src="https://maybeos.org/embed.js" data-org="your-slug" data-show="membership" defer></script>
 *
 * `data-show` defaults to "events" — the tag that is already pasted on real
 * websites has no such attribute, and must keep rendering exactly what it
 * rendered before this file learned a second trick.
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
  var accent = script.getAttribute('data-accent') || '#b03030';
  var show = script.getAttribute('data-show') === 'membership' ? 'membership' : 'events';

  // `data-limit` is gone (EVT-21). The feed is the next 30 days and every
  // event in it renders: a cap would silently hide events inside the window
  // the co-op is advertising, which is worse than a long list.

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
    // The accent carries the date as well as the price. It used to colour the
    // price alone, so a co-op whose events are free saw no change at all from
    // setting their brand colour (EVT-21).
    '.when { flex: 0 0 7.5rem; font-size: 13px; color: ' + accent + '; font-variant-numeric: tabular-nums; font-weight: 600; }',
    '.body { min-width: 0; flex: 1; }',
    '.title { font-weight: 600; }',
    '.meta { margin-top: 2px; font-size: 13px; color: #666; }',
    '.price { display: inline-block; margin-left: 8px; font-size: 12px; font-weight: 600; color: ' + accent + '; }',
    '.empty, .failed { padding: 24px 0; color: #666; font-size: 14px; }',
    '@media (max-width: 30rem) { .event { display: block; } .when { margin-bottom: 4px; } }',
    // Membership (PUB-01). Cards rather than rows: these are being compared,
    // not scanned in date order.
    '.tiers { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }',
    '.tier { border: 1px solid #e2e2e2; border-radius: 10px; padding: 20px; display: flex; flex-direction: column; }',
    '.tier-name { font-weight: 600; font-size: 17px; }',
    '.tier-price { margin-top: 4px; font-size: 22px; font-weight: 700; color: ' + accent + '; font-variant-numeric: tabular-nums; }',
    '.tier-per { font-size: 13px; font-weight: 500; color: #666; }',
    '.tier-desc { margin-top: 8px; font-size: 14px; color: #444; }',
    '.tier-benefits { margin: 12px 0 0; padding: 0; list-style: none; font-size: 14px; color: #444; }',
    '.tier-benefits li { padding-left: 18px; position: relative; margin-top: 6px; }',
    '.tier-benefits li::before { content: "✓"; position: absolute; left: 0; color: ' + accent + '; }',
    // Pushed to the bottom so buttons line up across cards of different heights.
    '.join { margin-top: auto; padding-top: 16px; }',
    '.join a { display: inline-block; width: 100%; text-align: center; text-decoration: none; padding: 10px 16px; border-radius: 8px; background: ' + accent + '; color: #fff; font-weight: 600; font-size: 14px; }',
    '.closed { margin-top: 16px; font-size: 14px; color: #666; }',
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

  // A tier card (PUB-01). Same textContent-only rule as the event row, for the
  // same reason: a tier name and its benefits are text a co-op typed, and this
  // runs on their domain.
  var card = function (tier, canJoin) {
    var el = document.createElement('div');
    el.className = 'tier';

    var name = document.createElement('div');
    name.className = 'tier-name';
    name.textContent = tier.name;
    el.appendChild(name);

    var price = document.createElement('div');
    price.className = 'tier-price';
    // Pay-what-you-can says so instead of showing its floor as the price,
    // which would read as a fixed fee — the opposite of what the tier means.
    if (tier.isPayWhatYouCan) {
      price.textContent = 'Pay what you can';
      if (tier.minPrice) {
        var from = document.createElement('span');
        from.className = 'tier-per';
        from.textContent = ' from ' + money(tier.minPrice, 'usd');
        price.appendChild(from);
      }
    } else if (tier.priceMonthly > 0) {
      price.textContent = money(tier.priceMonthly, 'usd');
      var per = document.createElement('span');
      per.className = 'tier-per';
      per.textContent = '/month';
      price.appendChild(per);
    } else {
      price.textContent = 'Free';
    }
    el.appendChild(price);

    if (tier.description) {
      var desc = document.createElement('div');
      desc.className = 'tier-desc';
      desc.textContent = tier.description;
      el.appendChild(desc);
    }

    var benefits = tier.benefits || [];
    if (benefits.length) {
      var list = document.createElement('ul');
      list.className = 'tier-benefits';
      benefits.forEach(function (benefit) {
        var li = document.createElement('li');
        li.textContent = benefit;
        list.appendChild(li);
      });
      el.appendChild(list);
    }

    if (canJoin) {
      var foot = document.createElement('div');
      foot.className = 'join';
      var a = document.createElement('a');
      // A new tab, because this leaves the co-op's own website for a sign-up
      // and payment — losing their page behind a checkout is a bad trade.
      a.target = '_blank';
      a.rel = 'noopener';
      a.href =
        origin +
        '/join?org=' +
        encodeURIComponent(slug) +
        '&tier=' +
        encodeURIComponent(tier.id);
      a.textContent = tier.priceMonthly > 0 || tier.isPayWhatYouCan
        ? 'Join as ' + tier.name
        : 'Join free';
      foot.appendChild(a);
      el.appendChild(foot);
    }

    return el;
  };

  var renderEvents = function (data) {
    var events = data.events || [];

    if (!events.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      // Says the window, so an empty embed reads as "nothing booked yet"
      // rather than as a broken script on the co-op's own website.
      empty.textContent = 'No events in the next 30 days.';
      wrap.appendChild(empty);
      return;
    }

    events.forEach(function (event) {
      wrap.appendChild(line(event));
    });
  };

  var renderMembership = function (data) {
    var tiers = data.tiers || [];

    if (!tiers.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Membership details are coming soon.';
      wrap.appendChild(empty);
      return;
    }

    var grid = document.createElement('div');
    grid.className = 'tiers';
    tiers.forEach(function (tier) {
      grid.appendChild(card(tier, !!data.allowPublicJoin));
    });
    wrap.appendChild(grid);

    // An invitation-only co-op still shows what membership costs — it is the
    // question a visitor came to answer — but a Join button that leads to a
    // refusal is worse than none, so it says why instead.
    if (!data.allowPublicJoin) {
      var closed = document.createElement('div');
      closed.className = 'closed';
      closed.textContent =
        (data.name || 'This community') + ' is invitation only — ask an organizer for an invite.';
      wrap.appendChild(closed);
    }
  };

  fetch(
    origin +
      '/api/embed/' +
      encodeURIComponent(slug) +
      (show === 'membership' ? '/membership' : '/events'),
  )
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      if (show === 'membership') renderMembership(data);
      else renderEvents(data);
    })
    .catch(function () {
      // Quiet on a co-op's marketing site: a stack trace where the events
      // should be is worse than a line of text, and the visitor can do nothing
      // with either.
      var failed = document.createElement('div');
      failed.className = 'failed';
      failed.textContent =
        show === 'membership'
          ? 'Membership details are unavailable right now.'
          : 'Events are unavailable right now.';
      wrap.appendChild(failed);
    });
})();

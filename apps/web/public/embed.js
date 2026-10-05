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

  // Text that can be read on the accent (BRD-03). The accent now defaults to
  // the co-op's own brand colour, and a co-op whose colour is pale — a light
  // blue, say — got white text on a solid button of it, which is unreadable.
  // Relative luminance, the same rule the WCAG contrast ratio is built on.
  var rgb = (function () {
    var hex = accent.replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  })();

  var luminance = function (c) {
    var ch = function (v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
  };

  // Text laid ON the accent. 0.179 is where white and black are equally
  // readable against a colour.
  var onAccent = !rgb ? '#fff' : luminance(rgb) > 0.179 ? '#1a1a1a' : '#fff';

  // The accent used AS text, on the card's white ground — prices, dates,
  // check marks. Same colour, darkened until it can be read: a pale brand
  // colour at 14px on white is a decoration, not a price. Hue is kept, which
  // is the point of inheriting the co-op's colour at all.
  var accentText = (function () {
    if (!rgb) return accent;
    var hex2 = function (c) {
      return (
        '#' +
        c
          .map(function (v) {
            var h = Math.round(v).toString(16);
            return h.length === 1 ? '0' + h : h;
          })
          .join('')
      );
    };
    for (var f = 1; f >= 0.1; f -= 0.05) {
      var scaled = [rgb[0] * f, rgb[1] * f, rgb[2] * f];
      // Contrast against white, the WCAG 4.5:1 threshold for body text.
      if (1.05 / (luminance(scaled) + 0.05) >= 4.5) return hex2(scaled);
    }
    return '#1a1a1a';
  })();

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
    '.when { flex: 0 0 7.5rem; font-size: 13px; color: ' + accentText + '; font-variant-numeric: tabular-nums; font-weight: 600; }',
    '.body { min-width: 0; flex: 1; }',
    '.title { font-weight: 600; }',
    '.meta { margin-top: 2px; font-size: 13px; color: #666; }',
    '.price { display: inline-block; margin-left: 8px; font-size: 12px; font-weight: 600; color: ' + accentText + '; }',
    '.empty, .failed { padding: 24px 0; color: #666; font-size: 14px; }',
    '@media (max-width: 30rem) { .event { display: block; } .when { margin-bottom: 4px; } }',
    /*
      The header above the prices (PUB-03).

      Charley, having put the cards on maybeitsfate.com/join: "Just showing
      the pricing cards doesn't work. The page needs more context."

      Modelled on the stat bar his own site had above its prices — big
      numerals, small capital labels, hairline rules between — because that
      shape reads as facts about a place rather than as marketing. The
      designer is adding the hero above this, so there is no headline here
      competing with theirs.
    */
    '.lead { margin: 0 0 20px; font-size: 16px; line-height: 1.5; color: #444; max-width: 46rem; }',
    '.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); border-top: 1px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; margin: 0 0 28px; }',
    // A rule between cells rather than around them, so the strip reads as one
    // object. The first cell has none, or the row starts with a stray line.
    '.stat { padding: 18px 20px; border-left: 1px solid #d8d8d8; }',
    '.stat:first-child { border-left: 0; padding-left: 0; }',
    '.stat-n { font-size: 30px; font-weight: 700; line-height: 1.1; color: #1a1a1a; font-variant-numeric: tabular-nums; }',
    '.stat-l { margin-top: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #777; }',
    /*
      No vertical rules once the strip wraps.

      `:first-child` clears the rule on the first cell only, and CSS cannot
      say "first of each row" under auto-fit — so at two columns the third
      cell started the row with a stray line down its left. Whitespace
      separates them perfectly well at this width.
    */
    '@media (max-width: 42rem) { .stat { padding: 14px 0; border-left: 0; } .stat-n { font-size: 26px; } }',
    // Membership (PUB-01). Cards rather than rows: these are being compared,
    // not scanned in date order.
    /*
      Wider cards (PUB-04). Charley: "Make the cards wider." 15rem fitted five
      across on a wide page and turned every benefit into two lines; 20rem
      gives three or four and lets a line of text be a line.

      The top padding is on the grid rather than on the featured card, which
      is what keeps the pill from pushing anything down: the room for it is
      made once, above all of them, so every card's title still sits on the
      same line as its neighbours'.
    */
    '.tiers { display: grid; gap: 20px; padding-top: 14px; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); }',
    /*
      A white ground, deliberately (PUB-04).

      These cards had a border and no background, so the host page showed
      through them — and MaybeItsFate's brand colour is #afd2e9, near enough
      their page's own blue that the accent vanished into it: the pill read as
      plain text and the buttons read as links. A card that supplies its own
      ground is a card that looks the same on anybody's website, which is the
      whole promise of an embed.
    */
    '.tier { background: #fff; border: 1px solid #dcdcdc; border-radius: 12px; padding: 24px; display: flex; flex-direction: column; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }',
    '.tier-name { font-weight: 600; font-size: 17px; }',
    '.tier-price { margin-top: 4px; font-size: 22px; font-weight: 700; color: ' + accentText + '; font-variant-numeric: tabular-nums; }',
    '.tier-per { font-size: 13px; font-weight: 500; color: #666; }',
    // Dark rather than grey: it is money somebody will be charged, not a note.
    '.tier-joining { margin-top: 4px; font-size: 13px; font-weight: 600; color: #333; }',
    '.tier-desc { margin-top: 8px; font-size: 14px; color: #444; }',
    '.tier-benefits { margin: 12px 0 0; padding: 0; list-style: none; font-size: 14px; color: #444; }',
    '.tier-benefits li { padding-left: 18px; position: relative; margin-top: 6px; }',
    '.tier-benefits li::before { content: "✓"; position: absolute; left: 0; color: ' + accentText + '; }',
    // Pushed to the bottom so buttons line up across cards of different heights.
    '.join { margin-top: auto; padding-top: 20px; }',
    /*
      A button that looks like one (PUB-04). Charley: "Make the button on each
      card look more like a button."

      It was a flat fill in the co-op's accent, which on a pale accent — his
      is #afd2e9 — is a pale rectangle with dark text and no edge, read as a
      line of text. The border gives it an outline whatever the fill, the
      shadow lifts it off the card, and the press moves it.
    */
    /*
      Filled with `accentText`, not the raw accent.

      The raw colour is the co-op's as chosen, and a pale one — #afd2e9 —
      makes a pale rectangle that reads as a panel rather than a control.
      `accentText` is that same hue darkened until it can be read, which is
      exactly what a button needs: a co-op with a strong colour sees no
      change, a co-op with a pale one gets a button instead of a tint.
    */
    '.join a { display: block; width: 100%; text-align: center; text-decoration: none; padding: 13px 18px; border-radius: 9px; background: ' + accentText + '; color: #fff; border: 1px solid ' + accentText + '; font-weight: 700; font-size: 15px; letter-spacing: 0.01em; box-shadow: 0 1px 3px rgba(0,0,0,0.18); transition: transform 0.06s ease, box-shadow 0.12s ease, filter 0.12s ease; }',
    '.join a:hover { filter: brightness(1.08); box-shadow: 0 3px 10px rgba(0,0,0,0.22); }',
    '.join a:active { transform: translateY(1px); box-shadow: 0 1px 2px rgba(0,0,0,0.14); }',
    '.closed { margin-top: 16px; font-size: 14px; color: #666; }',
    // The admin's own badge (MEM-16). The card is offset so the pill can sit
    // on its top border without the grid clipping it.
    /*
      The highlighted card, which has to carry across a room (PUB-04).
      Charley: "The highlighted card pops off the page with a strong outline
      and more visible pill."

      No `margin-top` any more — that was what pushed this card's text below
      its neighbours'. The grid already leaves room for the pill above every
      card, so this one only has to be unmistakable, not moved.

      The outline is drawn in `accentText` rather than the raw accent: a pale
      brand colour makes a pale outline, which is the thing that failed.
      `accentText` is the same colour darkened until it can be read, so the
      border is the co-op's colour at a strength that shows.
    */
    '.tier.featured { border: 3px solid ' + accentText + '; box-shadow: 0 6px 20px rgba(0,0,0,0.13); }',
    '.badge { position: absolute; top: -13px; left: 50%; transform: translateX(-50%); background: ' + accentText + '; color: #fff; border-radius: 999px; padding: 6px 16px; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.2); }',
    '.tier { position: relative; }',
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

    // Whatever the co-op wrote, not a claim of ours (MEM-16).
    var label = (tier.highlightLabel || '').trim();
    if (label) {
      el.className = 'tier featured';
      var badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = label;
      el.appendChild(badge);
    }

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

    /*
      The co-op's joining fee, under the monthly price (PAY-10).

      Beside the price rather than buried in the benefits, and drawn from the
      tier's own figure rather than from a line somebody remembered to type —
      a co-op that changes the amount should not have to remember to change
      the sentence as well.
    */
    if (tier.initiationFeeCents > 0) {
      var joining = document.createElement('div');
      joining.className = 'tier-joining';
      joining.textContent = '+ ' + money(tier.initiationFeeCents, 'usd') + ' once, to join';
      el.appendChild(joining);
    }

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

  /** "$19.50", "$10" — cents only when there are cents. */
  var money = function (cents) {
    return '$' + (cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2));
  };

  /**
   * The stat strip and the sentence above the prices (PUB-03).
   *
   * Every figure is counted at load rather than typed into the page once: a
   * co-op that writes "400+ members" onto their website is writing a number
   * that is wrong within a year, and wrong in the direction that makes them
   * look smaller than they are.
   *
   * A cell is only drawn when it has something true to say — a co-op with no
   * rooms does not advertise nought rooms — so the strip is three cells wide
   * for one co-op and four for another, and the grid handles both.
   */
  var header = function (data) {
    var stats = data.stats || {};
    var cells = [];

    if (stats.members > 0) {
      cells.push([String(stats.members), stats.members === 1 ? 'Active member' : 'Active members']);
    }
    if (stats.rooms > 0) {
      cells.push([
        String(stats.rooms),
        stats.rooms === 1 ? 'Room to book for your gatherings' : 'Rooms to book for your gatherings',
      ]);
    }
    /*
      Two counts of the same month, which is the point of showing both (PUB-03).

      The first is what a visitor could come to; the second includes the
      private bookings, which is how busy the building actually is. Drawn
      whenever the month has anything in it at all — a zero beside "total
      events" would be worth knowing, but these cells exist to be read quickly
      and the empty-month case is already covered by the strip shrinking.
    */
    if (stats.openEvents > 0) {
      cells.push([String(stats.openEvents), 'Non-private events this month']);
    }
    if (stats.allEvents > 0) {
      cells.push([String(stats.allEvents), 'Total events this month']);
    }

    var lead = (data.mission || data.description || '').trim();
    if (lead) {
      var p = document.createElement('p');
      p.className = 'lead';
      p.textContent = lead;
      wrap.appendChild(p);
    }

    if (!cells.length) return;

    var strip = document.createElement('div');
    strip.className = 'stats';
    cells.forEach(function (cell) {
      var box = document.createElement('div');
      box.className = 'stat';

      var n = document.createElement('div');
      n.className = 'stat-n';
      n.textContent = cell[0];

      var l = document.createElement('div');
      l.className = 'stat-l';
      l.textContent = cell[1];

      box.appendChild(n);
      box.appendChild(l);
      strip.appendChild(box);
    });
    wrap.appendChild(strip);
  };

  var renderMembership = function (data) {
    var tiers = data.tiers || [];

    // Context before prices (PUB-03). Drawn even when there are no tiers yet,
    // because "here is the place, membership is coming" is still an answer.
    header(data);

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

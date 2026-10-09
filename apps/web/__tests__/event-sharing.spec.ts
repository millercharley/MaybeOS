import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MEMBERS_ONLY_REASON,
  SHARE_LABEL,
  shareability,
  shouldOfferAfterPublish,
} from '@/lib/event-sharing';

/**
 * Finding the way to Instagram (SOC-02).
 *
 * Charley: "It's not clear in the UX how someone can post their event to the
 * MaybeItsFate Instagram and Facebook Page."
 *
 * It was connected and it worked. In the three and a half weeks after the
 * Page and the Instagram account were linked, not one event was posted —
 * because the button was on one of the product's seven event screens, said
 * only "Share", and vanished without explanation on the 97% of events that
 * are members-only.
 */
const event = (over: Record<string, unknown> = {}) => ({
  isPublished: true,
  visibility: 'PUBLIC',
  startTime: '2026-12-01T18:00:00.000Z',
  endTime: '2026-12-01T20:00:00.000Z',
  ...over,
});

const NOW = new Date('2026-11-01T00:00:00.000Z');

describe('whether an event can go out', () => {
  it('offers a public event that is still to come', () => {
    expect(shareability(event(), true, NOW)).toEqual({ state: 'ready' });
  });

  it('explains a members-only event rather than hiding', () => {
    /*
      The case a host actually meets: 753 of MaybeItsFate's 777 events are
      members-only. Hiding the button there taught people the feature did
      not exist, rather than that this event did not qualify.
    */
    const out = shareability(event({ visibility: 'MEMBERS_ONLY' }), true, NOW);

    expect(out).toEqual({ state: 'blocked', reason: MEMBERS_ONLY_REASON });
  });

  it('tells them what to change, not just that they cannot', () => {
    // A reason a host can act on. Visibility is a field on the edit form.
    expect(MEMBERS_ONLY_REASON).toMatch(/Public/);
  });

  it('says nothing at a co-op that has connected nothing', () => {
    // Not every co-op has a Facebook Page, and an explanation of a feature
    // they have not set up is noise on every event they own.
    expect(shareability(event(), false, NOW).state).toBe('hidden');
  });

  it('says nothing about a draft', () => {
    // It already says it is a draft, and "publish it first" on every
    // unpublished row is noise.
    expect(shareability(event({ isPublished: false }), true, NOW).state).toBe('hidden');
  });

  it('says nothing about something already over', () => {
    expect(shareability(event(), true, new Date('2026-12-02T00:00:00.000Z')).state).toBe('hidden');
  });

  it('counts an event as over once it has started, if it never says when it ends', () => {
    // Otherwise an event with no end time stays shareable for ever.
    const open = event({ endTime: null });

    expect(shareability(open, true, new Date('2026-11-30T00:00:00.000Z')).state).toBe('ready');
    expect(shareability(open, true, new Date('2026-12-01T19:00:00.000Z')).state).toBe('hidden');
  });

  it('is still shareable during the event, while it has an end', () => {
    // Somebody posting "we are open now" is the point, not an edge case.
    expect(shareability(event(), true, new Date('2026-12-01T19:00:00.000Z')).state).toBe('ready');
  });

  it('says nothing about a cancelled event', () => {
    expect(shareability(event({ canceledAt: '2026-11-02T00:00:00.000Z' }), true, NOW).state)
      .toBe('hidden');
  });
});

describe('offering it the moment it goes live', () => {
  it('offers a public event', () => {
    expect(shouldOfferAfterPublish(event(), true)).toBe(true);
  });

  it('does not raise a dialog only to say it cannot be shared', () => {
    // Publishing a members-only event must not open a modal whose single
    // message is "not this one".
    expect(shouldOfferAfterPublish(event({ visibility: 'MEMBERS_ONLY' }), true)).toBe(false);
  });

  it('stays out of the way where nothing is connected', () => {
    expect(shouldOfferAfterPublish(event(), false)).toBe(false);
  });
});

describe('every screen that lists or shows an event', () => {
  const read = (...parts: string[]) =>
    readFileSync(join(__dirname, '..', ...parts), 'utf8');

  const adminList = read('app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'events', 'page.tsx');
  const memberList = read('app', '(app)', '(dashboard)', 'member', '[orgSlug]', 'events', 'page.tsx');
  const overview = read('components', 'events', 'event-overview.tsx');

  it('offers it in the admin console, where organisers were never given it', () => {
    /*
      The sharpest gap. The API has always allowed it — `if (!actor.staff &&
      event.hostId !== actor.userId)` — so the co-op's own organisers were
      authorised to post any public event and had no button anywhere.
    */
    expect(adminList).toMatch(/shareability\(/);
    expect(adminList).toMatch(/<ShareEventDialog\b/);
  });

  it('offers it on the event page itself, both of them', () => {
    // EventOverview is the admin's event page and the host's; one button
    // here is the two that were missing.
    expect(overview).toMatch(/shareability\(/);
    expect(overview).toMatch(/<ShareEventDialog\b/);
  });

  it('keeps it on the member list it was already on', () => {
    expect(memberList).toMatch(/shareability\(/);
  });

  it('says what it is, everywhere', () => {
    // It read "Share", between Edit and Cancel, with nothing to say it
    // meant the co-op's Instagram.
    expect(SHARE_LABEL).toMatch(/Instagram/);
    expect(SHARE_LABEL).toMatch(/Facebook/);
    for (const src of [adminList, memberList, overview]) {
      expect(src).toMatch(/SHARE_LABEL/);
    }
  });

  it('decides it in one place, so the screens cannot disagree', () => {
    /*
      The rule used to be inline — `sharingOn && event.isPublished &&
      event.visibility === 'PUBLIC' && !ended` — in the one file that had it.
      Copied to three more screens, that is three chances to drift apart, and
      a Share button that disagrees with the API is a refusal after the click.

      So every button is gated on the shared verdict and nothing re-derives
      it. The visibility *badges* on these pages read the same field and are
      none of this function's business, which is why this looks at what
      guards the button rather than banning the field outright.
    */
    for (const src of [adminList, memberList, overview]) {
      const at = src.indexOf('SHARE_LABEL}');
      expect(at).toBeGreaterThan(-1);

      const guard = src.slice(Math.max(0, at - 700), at);
      expect(guard).toMatch(/share\.state === 'ready'/);
      expect(guard).not.toMatch(/visibility ===/);
    }
  });

  it('cannot take the door list down if the org will not load', () => {
    /*
      The org fetch rides in the same `Promise.all` as the attendees and the
      event, so it costs no extra round trip — and `Promise.all` rejects as
      a whole. Uncaught, a failure there would blank the check-in list over
      whether to draw one button. The tickets beside it are fetched apart
      for the same reason.
    */
    const doorList = read('components', 'events', 'door-list.tsx');
    const at = doorList.indexOf('api.orgs.get(');
    expect(at).toBeGreaterThan(-1);
    expect(doorList.slice(at, at + 120)).toMatch(/\.catch\(\(\) => null\)/);
  });

  it('offers it the moment an event is published', () => {
    for (const src of [adminList, memberList]) {
      expect(src).toMatch(/shouldOfferAfterPublish\(/);
    }
  });
});

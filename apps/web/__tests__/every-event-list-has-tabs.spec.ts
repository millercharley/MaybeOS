import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXEMPT,
  HAND_ROLLED,
  offencesIn,
  screenFiles,
  sweep,
  WEB,
} from './helpers/event-list-scan';

/**
 * Past events behind a tab, on every screen (EVT-49).
 *
 * Charley: "Always provide a second tab on any screen where previous events
 * are listed so that previous events all live together and are searchable,
 * not listed with upcoming events. … Run a sweep of every page a member or an
 * admin might use where events are listed to comply with this rule."
 *
 * The sweep found three — My Events, the Going panel inside it, and the admin
 * console — and each had independently grown a "Past" section stacked under a
 * "Coming up" one. This is what stops the fourth.
 */

describe('the sweep', () => {
  it('finds nothing listing past events without tabs', () => {
    const offences = sweep();

    // Named in the failure, because "a file somewhere" is not actionable.
    expect(offences.map((o) => `${o.file}: ${o.why}`)).toEqual([]);
  });

  it('actually looked at the screens it claims to have looked at', () => {
    // A walk that silently collected nothing would pass the test above.
    const files = screenFiles();

    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('app/(app)/(dashboard)/member/[orgSlug]/events/page.tsx');
    expect(files).toContain('app/(app)/(dashboard)/admin/[orgSlug]/events/page.tsx');
    expect(files).toContain('components/events/my-rsvps.tsx');
  });
});

describe('the three screens the sweep fixed', () => {
  const read = (file: string) => readFileSync(join(WEB, file), 'utf8');

  const screens = [
    ['My Events', 'app/(app)/(dashboard)/member/[orgSlug]/events/page.tsx'],
    ['the Going panel', 'components/events/my-rsvps.tsx'],
    ['the admin console', 'app/(app)/(dashboard)/admin/[orgSlug]/events/page.tsx'],
  ] as const;

  it.each(screens)('%s has the two tabs', (_name, file) => {
    expect(read(file)).toMatch(/<EventTabs/);
  });

  it.each(screens)('%s can be searched', (_name, file) => {
    expect(read(file)).toMatch(/onSearch=\{/);
    expect(read(file)).toMatch(/searchEvents\(/);
  });

  it.each(screens)('%s splits through the shared rule', (_name, file) => {
    expect(read(file)).toMatch(/splitEvents\(/);
  });

  it('no longer offers a tab that mixes the two', () => {
    // The admin console's "All" was 767 events of both kinds in one scroll,
    // and its "Draft" held 2025 alongside next spring. Drafts narrow a side
    // now rather than being a third kind of date.
    const admin = read('app/(app)/(dashboard)/admin/[orgSlug]/events/page.tsx');

    expect(admin).not.toMatch(/key: 'all'/);
    expect(admin).toMatch(/Drafts only/);
  });
});

describe('what the rule refuses', () => {
  const offences = (source: string) => offencesIn('components/made-up.tsx', source);

  it('refuses a hand-rolled list of past events', () => {
    expect(offences('const past = events.filter((e) => e.isPast);')).toHaveLength(1);
  });

  it('allows keeping only what is ahead, which lists no past at all', () => {
    // A screen with no past events on it needs no tab for them.
    expect(offences('const soon = events.filter((e) => !e.isPast);')).toEqual([]);
  });

  it('refuses treating cancelled as past', () => {
    // A reservation called off for next Tuesday is not a past booking, and
    // an RSVP you withdrew is not a past event.
    //
    // This line breaks both rules at once — it is a hand-rolled past list
    // *and* a conflation — and both are reported, because a file is fixed by
    // knowing everything wrong with it rather than the first thing.
    const why = offences('const past = all.filter((r) => r.isPast || r.canceled);').map(
      (o) => o.why,
    );

    expect(why).toContain('treats cancelled as past; splitEvents separates by time only');
  });

  it('refuses calling an event past once it has started', () => {
    expect(offences('const isPast = new Date(event.startTime) < now;')).toHaveLength(1);
  });

  it('refuses a split with no tabs', () => {
    expect(offences('const { upcoming, past } = splitEvents(events);')).toEqual([
      {
        file: 'components/made-up.tsx',
        why: 'splits events into upcoming and past without rendering EventTabs',
      },
    ]);
  });

  it('accepts a split that renders tabs', () => {
    expect(
      offences('const { upcoming, past } = splitEvents(events);\n<EventTabs tab={tab} />'),
    ).toEqual([]);
  });

  it('reads code, not the prose explaining it', () => {
    /*
      The opposite of the API's address scan, which reads comments because
      that is where its leaks were. These files quote the filters they used
      to have — `my-rsvps.tsx` quotes `r.isPast || r.status === 'CANCELED'`
      verbatim — so a scan that matched its own explanation would fail on the
      fix.
    */
    expect(offences("// was: events.filter((e) => e.isPast)\nconst x = 1;")).toEqual([]);
    expect(offences('/* r.isPast || r.status */\nconst x = 1;')).toEqual([]);
  });
});

describe('the exemption', () => {
  it('exempts no file but the ones listed, whatever its path', () => {
    /*
      Planted at every real path, so the test guards the filter rather than
      the variable. The first version of the API's address guard passed with
      eighteen green tests while a second skip beside `EXEMPT` hid a planted
      address, because the assertion only read the list.
    */
    const planted = 'const past = events.filter((e) => e.isPast);';
    const slipped = screenFiles().filter((file) => offencesIn(file, planted).length === 0);

    expect(slipped.sort()).toEqual([...EXEMPT].sort());
  });

  it('exempts the file that defines the rule, and says why', () => {
    expect(EXEMPT).toEqual(['lib/event-tabs.ts']);
  });

  it('checks every pattern it declares', () => {
    // A pattern added to the list and never run is a rule nothing keeps.
    for (const { pattern } of HAND_ROLLED) {
      expect(pattern.source.length).toBeGreaterThan(0);
    }
    expect(HAND_ROLLED).toHaveLength(3);
  });
});

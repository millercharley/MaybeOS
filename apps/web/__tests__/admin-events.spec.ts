import { stripComments } from './helpers/source-scan';
import { readFileSync } from 'fs';
import { join } from 'path';
import { adminEmptyNote, adminEventWindow, adminWindowKey } from '@/lib/event-list';

/**
 * The organiser's Events console, after an import (EVT-27, EVT-30).
 *
 * Charley opened it to "No events found for this filter" under Upcoming,
 * with 209 upcoming events in the co-op. The page filtered its tabs over
 * whatever the API's default page held — twenty events, ascending from the
 * start of the co-op's history — so after 777 arrived it was filtering
 * November 2024 and finding nothing.
 *
 * And: "Make sure as an admin, I have the ability to hide or delete any
 * events (I see duplicate events that were duplicated in my google
 * calendar)."
 */

/*
  Comments are blanked by `stripComments` before any of this reads the file,
  line breaks kept so a failure still points at a line.

  Two assertions below locate a control by slicing around the first
  occurrence of a word — `indexOf('Hide')` for the Hide button. The page
  documents itself heavily, so the first "Hide" in the file stopped being the
  button the moment a comment mentioned hiding (EVT-53), and the test failed
  on a change that touched nothing it was guarding.

  The word is still the anchor, because the alternative is pinning markup
  that is allowed to move. Stripping prose is what makes the anchor mean the
  control rather than the paragraph about it.
*/
const page = stripComments(
  readFileSync(
    join(__dirname, '..', 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'events', 'page.tsx'),
    'utf8',
  ),
);

describe('which events each tab asks for', () => {
  const now = new Date('2026-10-02T19:30:00Z');

  it('asks for what is ahead on Upcoming, from midnight', () => {
    const { from, to } = adminEventWindow('upcoming', now);

    expect(new Date(from!).getHours()).toBe(0);
    expect(to).toBeUndefined();
  });

  it('asks for what is behind on Past', () => {
    const { from, to } = adminEventWindow('past', now);

    expect(to).toBe(now.toISOString());
    expect(from).toBeUndefined();
  });

  it('asks for the upcoming stretch on Draft, not the lot (EVT-63)', () => {
    /*
      This used to assert the opposite, on the reasoning that "an unpublished
      event is as likely to be past as future — that is often why it is still
      a draft". The observation is true and it is exactly what made the old
      Draft tab useless: it opened on unpublished events from 2025 beside
      ones for next spring, which is why the tab was removed on 3 November.

      Charley, 2026-11-19: "Bring the Drafts tab back with only upcoming."
      The same window as Upcoming is what makes it a working queue. Past
      drafts are reached through Past with the Drafts-only box ticked.
    */
    expect(adminEventWindow('draft', now)).toEqual(adminEventWindow('upcoming', now));
    expect(new Date(adminEventWindow('draft', now).from!).getHours()).toBe(0);
    expect(adminEventWindow('draft', now).to).toBeUndefined();
  });

  it('still asks for everything on All, which the console does not use', () => {
    expect(adminEventWindow('all', now)).toEqual({ perPage: 100 });
  });

  it('asks for as many as the API will give', () => {
    expect(adminEventWindow('upcoming', now).perPage).toBe(100);
  });

  it('refetches when the stretch changes, not on every tab (EVT-63)', () => {
    /*
      This pinned `[activeTab]`, which was right while the tabs were the two
      time windows. Drafts asks for the same stretch as Upcoming, so keying
      the fetch on the tab would discard a hundred events and fetch the
      identical hundred back, with a spinner over a list already in hand.

      Keyed on the window instead. The call still passes the tab, because
      the tab is what decides the window.
    */
    expect(page).toMatch(/adminEventWindow\(activeTab, new Date\(\)\)/);
    expect(page).toMatch(/\[adminWindowKey\(activeTab\)\]/);
  });
});

describe('what an organiser can do to an event', () => {
  it('can hide a published one', () => {
    expect(page).toMatch(/hideEvent\(event\.id\)/);
    expect(page).toMatch(/event\.isPublished && \(/);
  });

  it('does not offer to hide one that is already hidden', () => {
    // A draft is already off the members' lists.
    const hide = page.slice(page.indexOf('Hide') - 900, page.indexOf('Hide'));

    expect(hide).toMatch(/event\.isPublished/);
  });

  it('asks before deleting', () => {
    expect(page).toMatch(/setConfirmDelete\(/);
    expect(page).toMatch(/This cannot be undone/);
  });

  it('says how many people are losing it, since nothing stops the delete now', () => {
    /*
      This asserted the words "hide or cancel it instead", which was the old
      refusal written out as advice: an RSVP stopped a delete outright
      (EVT-50). It no longer does, so the count is the only warning there
      is, and it has to say that nobody will be told.
    */
    expect(page).toMatch(/will not be told/);
    expect(page).not.toMatch(/hide or cancel it instead/);
  });

  it('shows the API’s refusal rather than a generic failure', () => {
    // The refusal names how many tickets are unrefunded, which is the whole
    // value of it.
    expect(page).toMatch(/err instanceof Error \? err\.message : 'Could not delete that event'/);
  });

  it('stops the card’s link from swallowing either click', () => {
    // Both sit inside the card's <Link>, like Edit above them.
    const actions = page.slice(page.indexOf('hideEvent(event.id)') - 400);

    expect(actions).toMatch(/e\.preventDefault\(\);/);
    expect(actions).toMatch(/e\.stopPropagation\(\);/);
  });
});

/**
 * What an organiser's event card says, and what they can do once inside
 * (EVT-35).
 *
 * Charley: "instead of showing location, display the host(s)… if tickets are
 * sold, show how many tickets have sold out of how many available… make sure
 * there are the options to Edit, Hide, and Delete the event so the admin
 * doesn't have to go backwards to the Events menu."
 */
describe('what a card says', () => {
  it('names who is running it instead of where it is', () => {
    // At a co-op with one building the location is the same words on every
    // card, and "TBD" on the many that never set one.
    expect(page).toMatch(/hostLine\(event\)/);
    expect(page).not.toMatch(/event\.location\?\.name \?\? 'TBD'/);
  });

  it('says how ticket sales are going, when there are any', () => {
    expect(page).toMatch(/ticketLine\(event\) && \(/);
  });
});

describe('arriving to edit one event', () => {
  it('opens the form for the event named in the address', () => {
    expect(page).toMatch(/get\('edit'\)/);
    expect(page).toMatch(/setEditing\(match\)/);
  });

  it('takes it out of the address once used', () => {
    // Otherwise a refresh reopens it, and so does the back button.
    expect(page).toMatch(/history\.replaceState/);
  });

  it('waits until the events are loaded, since the form needs one', () => {
    expect(page).toMatch(/\}, \[eventsData\]\);/);
  });
});

/**
 * The Drafts tab, back and carrying only what is ahead (EVT-63).
 *
 * Charley, 2026-11-19: "Bring the Drafts tab back with only upcoming."
 *
 * The tab was removed on 3 November for a real reason — it listed
 * unpublished events from 2025 beside ones for next spring, which is the
 * stacking EVT-49 bans. *Only upcoming* is that reason removed rather than
 * reinstated, so this is not a revert: the half that was useful comes back
 * and the half that broke the rule does not.
 *
 * It is also the missing screen behind `mig-hidden-drafts`. Eighteen hidden
 * events accumulated with nobody noticing a number because nothing listed
 * them, so there was no number to notice.
 */
describe('the Drafts tab', () => {
  it('is offered beside the two time tabs, not among them', () => {
    // `extraTabs` renders after Upcoming and Past deliberately: a third pill
    // between them would read as a third kind of date.
    expect(page).toMatch(/extraTabs=\{\[\{ key: 'draft', label: 'Drafts' \}\]\}/);
  });

  it('carries a count, which is the point of it', () => {
    // The 18 that accumulated unnoticed had no number anywhere.
    expect(page).toMatch(/draft: draftsAmong\(upcoming\)\.length/);
  });

  it('counts only what is ahead, never the past drafts', () => {
    // `draftsAmong(upcoming)`, not `draftsAmong(events)` — a pill reading 300
    // because of 2024 is the old tab's bug wearing a badge.
    expect(page).not.toMatch(/draft: draftsAmong\(events\)/);
    expect(page).not.toMatch(/draft: draftsAmong\(past\)/);
  });

  it('hides the Drafts-only checkbox on it, where it says nothing', () => {
    expect(page).toMatch(/activeTab !== 'draft' && \(/);
  });

  it('keeps the checkbox for the other two, which is how past drafts are reached', () => {
    expect(page).toMatch(/checked=\{draftsOnly\}/);
  });

  it('shares its fetched window with Upcoming', () => {
    expect(adminWindowKey('draft')).toBe('upcoming');
    expect(adminWindowKey('upcoming')).toBe('upcoming');
    expect(adminWindowKey('past')).toBe('past');
  });
});

describe('what the console says when a list is empty', () => {
  /*
    Four different nothings (DESIGN §7). "No events found for this filter"
    answered all four at once, which is how a screen tells somebody nothing.
  */
  it('says so when a search matches nothing, whichever tab', () => {
    for (const tab of ['upcoming', 'past', 'draft'] as const) {
      expect(adminEmptyNote(tab, false, true)).toBe('Nothing matches that.');
    }
  });

  it('tells an organiser what the Drafts tab is for when it is empty', () => {
    expect(adminEmptyNote('draft', false, false)).toBe(
      'No drafts coming up. An event you save without publishing waits here.',
    );
  });

  it('distinguishes no drafts behind from no drafts ahead', () => {
    expect(adminEmptyNote('past', true, false)).toBe('No drafts among the past events.');
    expect(adminEmptyNote('upcoming', true, false)).toBe('No drafts coming up.');
  });

  it('falls back to the shared wording for a genuinely empty stretch', () => {
    expect(adminEmptyNote('upcoming', false, false)).toBe('Nothing coming up.');
    expect(adminEmptyNote('past', false, false)).toMatch(/once they have happened/);
  });

  it('is the only thing the page says about an empty list', () => {
    /*
      This assertion used to be the first line alone, and it was not worth
      much: it proved the good sentence was called, not that it was the only
      one. The grid below carried its own "No events found for this filter."
      and both rendered at once — a specific empty state with the generic one
      it replaced printed underneath. Found by opening the tab and searching
      for something absent.

      `page` has its comments stripped, so the sentence quoted in the page's
      own note about this does not satisfy the scan.
    */
    expect(page).toMatch(/adminEmptyNote\(activeTab, draftsOnly, Boolean\(search\.trim\(\)\)\)/);
    expect(page).not.toMatch(/No events found for this filter/);
    expect(page.match(/filtered\.length === 0/g) ?? []).toHaveLength(1);
  });
});

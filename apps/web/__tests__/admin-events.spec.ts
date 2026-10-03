import { readFileSync } from 'fs';
import { join } from 'path';
import { adminEventWindow } from '@/lib/event-list';

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

const page = readFileSync(
  join(__dirname, '..', 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'events', 'page.tsx'),
  'utf8',
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

  it('asks for everything on All and Draft', () => {
    // An unpublished event is as likely to be past as future — that is often
    // why it is still a draft.
    expect(adminEventWindow('all', now)).toEqual({ perPage: 100 });
    expect(adminEventWindow('draft', now)).toEqual({ perPage: 100 });
  });

  it('asks for as many as the API will give', () => {
    expect(adminEventWindow('upcoming', now).perPage).toBe(100);
  });

  it('refetches when the tab changes', () => {
    expect(page).toMatch(/adminEventWindow\(activeTab, new Date\(\)\)/);
    expect(page).toMatch(/\[activeTab\]/);
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

  it('says what to do instead when somebody is expecting it', () => {
    expect(page).toMatch(/hide or cancel it instead/);
  });

  it('shows the API’s refusal rather than a generic failure', () => {
    // The refusal names how many people are expecting it, which is the whole
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

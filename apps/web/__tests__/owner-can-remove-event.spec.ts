import { stripComments } from './helpers/source-scan';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Hiding and deleting your own event (EVT-50).
 *
 * Charley: "Allow for the deletion (or hiding if that's safer) by the admin or
 * owner of future events that have an RSVP. This is not the same for sold
 * tickets to future events: those can't be deleted or hidden until all tickets
 * have been refunded."
 *
 * Both routes were organiser-only and had no button on the member's side at
 * all, so a member who made a duplicate had to ask somebody to clear it up.
 */
const strip = (s: string) => stripComments(s);

const page = strip(
  readFileSync(
    join(__dirname, '..', 'app', '(app)', '(dashboard)', 'member', '[orgSlug]', 'events', 'page.tsx'),
    'utf8',
  ),
);
const controller = strip(
  readFileSync(
    join(__dirname, '..', '..', 'api', 'src', 'modules', 'events', 'events.controller.ts'),
    'utf8',
  ),
);

describe('what the owner can now do to their own event', () => {
  it('can hide it', () => {
    expect(page).toMatch(/api\.events\.unpublish\(orgId, eventId, token\)/);
    expect(page).toMatch(/onHide=\{hide\}/);
  });

  it('can delete it', () => {
    expect(page).toMatch(/api\.events\.remove\(orgId, eventId, token\)/);
    expect(page).toMatch(/onDelete=\{remove\}/);
  });

  it('is asked before the one that cannot be undone', () => {
    expect(page).toMatch(/confirmingDelete/);
    expect(page).toMatch(/Yes, delete/);
  });

  it('is not asked before hiding, which is reversible', () => {
    expect(page).toMatch(/onClick=\{\(\) => onHide\(event\.id\)\}/);
  });

  it('only offers Hide on something that is actually showing', () => {
    expect(page).toMatch(/onHide && event\.isPublished/);
  });

  it('keeps Cancel, which is a different act with different consequences', () => {
    // Cancelling tells people and refunds them. Deleting does neither.
    expect(page).toMatch(/Cancel event/);
    expect(page).toMatch(/Yes, call it off/);
  });
});

describe('what the member is told before deleting', () => {
  it('names how many people are expecting it', () => {
    // An RSVP no longer refuses a delete, so the count is the only warning
    // there is.
    expect(page).toMatch(/expecting this\. Delete anyway\?/);
    expect(page).toMatch(/event\.rsvpCount/);
  });

  it('says something different when nobody is', () => {
    expect(page).toMatch(/Delete for good\?/);
  });

  it('shows the API’s refusal, which names the unrefunded tickets', () => {
    expect(page).toMatch(/Could not delete that/);
    expect(page).toMatch(/Could not hide that/);
  });
});

describe('what the routes ask for', () => {
  it('gates neither on a role, because "admin or owner" is not one', () => {
    const hide = controller.slice(
      controller.indexOf("@Post('orgs/:orgId/events/:eventId/unpublish')"),
    );
    const del = controller.slice(controller.indexOf("@Delete('orgs/:orgId/events/:eventId')"));

    expect(hide.slice(0, 600)).not.toMatch(/@Roles\(/);
    expect(del.slice(0, 600)).not.toMatch(/@Roles\(/);
  });
});

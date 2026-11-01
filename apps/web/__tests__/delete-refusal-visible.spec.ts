import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The refusal reaches the person who caused it (EVT-53).
 *
 * Deleting an event with a confirmed RSVP or a sold ticket is refused by the
 * API, deliberately, and the refusal is a whole sentence worth reading:
 *
 *     "1 member is expecting this event, so it cannot be deleted. Cancel it
 *      instead, or hide it if it was never meant to be there."
 *
 * On the admin events page that sentence went to `formError`, which is passed
 * to `EventForm` — and `EventForm` is only mounted while creating or editing.
 * Click Delete it on a card and nothing was rendering the reason anywhere on
 * the page. The confirm box stayed open, the button flickered through
 * "Deleting…", and the organiser was told nothing.
 *
 * On the event detail page it went to `hostError`, which renders inside the
 * co-hosts card — visible, but in the wrong place and under the wrong
 * heading.
 *
 * Refusing is correct. Refusing silently is the bug, so what these pin is
 * that the message has somewhere to land next to the control that triggered
 * it.
 */
const read = (...parts: string[]) =>
  readFileSync(join(__dirname, '..', ...parts), 'utf8')
    // Comments blanked, line breaks kept: these files now *describe* the bug
    // in prose, and a scan that matched prose would pass on documentation
    // alone.
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');

const slice = (src: string, from: string, length: number) => {
  const at = src.indexOf(from);
  expect(at).toBeGreaterThan(-1);
  return src.slice(at, at + length);
};

describe('admin events page', () => {
  const PAGE = read('app/(app)/(dashboard)/admin/[orgSlug]/events/page.tsx');

  it('keeps row failures out of the form’s error, which is not mounted', () => {
    const del = slice(PAGE, 'async function deleteEvent(', 1200);
    const hide = slice(PAGE, 'async function hideEvent(', 700);

    expect(del).not.toContain('setFormError');
    expect(hide).not.toContain('setFormError');
    expect(del).toContain('setActionError');
    expect(hide).toContain('setActionError');
  });

  it('remembers which row the failure belongs to', () => {
    // One page draws every event — 793 of them for MaybeItsFate — so a
    // message with no row is a message against the wrong event.
    expect(slice(PAGE, 'async function deleteEvent(', 1200)).toMatch(/id: eventId,/);
    expect(slice(PAGE, 'async function hideEvent(', 700)).toMatch(/id: eventId,/);
  });

  it('renders the refusal inside the confirm box', () => {
    expect(PAGE).toMatch(
      /actionError\?\.id === event\.id && \(\s*\n\s*<p[\s\S]{0,200}\{actionError\.message\}/,
    );
  });

  it('renders a failed Hide too, which has no confirm box', () => {
    expect(PAGE).toMatch(
      /actionError\?\.id === event\.id && confirmDelete !== event\.id/,
    );
  });

  it('clears the last refusal when the box is reopened', () => {
    // Otherwise yesterday's reason sits above today's attempt.
    expect(PAGE).toMatch(/setActionError\(null\);\s*\n\s*setConfirmDelete\(/);
  });

  it('still lets the form report its own errors', () => {
    // `formError` is not wrong, it was only being borrowed. Create and edit
    // genuinely render inside EventForm.
    expect(PAGE).toContain('error={formError}');
  });
});

describe('event detail overview', () => {
  const VIEW = read('components/events/event-overview.tsx');

  it('does not report a delete failure in the co-hosts card', () => {
    const del = slice(VIEW, 'await api.events.remove(', 600);
    expect(del).not.toContain('setHostError');
    expect(del).toContain('setDeleteError');
  });

  it('renders the refusal beside the delete buttons', () => {
    const box = slice(VIEW, 'Delete “{event.title}” for good?', 900);
    expect(box).toMatch(/\{deleteError && \(/);
    expect(box).toContain('{deleteError}');
  });

  it('clears it on Keep it', () => {
    expect(VIEW).toMatch(/setDeleteError\(''\);\s*\n\s*setConfirmDelete\(false\);/);
  });

  it('leaves the co-host errors alone', () => {
    // The co-host actions still have their own failures to report.
    expect(VIEW).toContain('setHostError');
    expect(VIEW).toContain('{hostError}');
  });
});

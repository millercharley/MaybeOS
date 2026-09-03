import { calendarNotice, calendarState } from '@/lib/room-calendar';

/**
 * Connected is not the same as chosen (SPC-13).
 *
 * A room that holds a Google token but has no calendar id used to be
 * indistinguishable from one that was fully set up — the page said "Calendar
 * connected" and stopped there, while every booking silently went to the
 * primary calendar of whichever organiser had pressed the button.
 */
describe('calendarState', () => {
  it('is disconnected when nothing has been authorised', () => {
    expect(calendarState({})).toBe('disconnected');
  });

  it('is connected — not syncing — when an account is authorised but no calendar chosen', () => {
    expect(calendarState({ googleAccountEmail: 'coop@example.org' })).toBe('connected');
  });

  it('is syncing once a calendar has been chosen', () => {
    expect(
      calendarState({
        googleAccountEmail: 'coop@example.org',
        googleCalendarId: 'attic@group.calendar.google.com',
      }),
    ).toBe('syncing');
  });

  it('counts a room connected before an older record grew an account address', () => {
    // Rooms connected before SPC-13 have a calendar id and no account email.
    expect(calendarState({ googleCalendarId: 'attic@group.calendar.google.com' })).toBe('syncing');
  });
});

describe('calendarNotice', () => {
  it('says a connected room still needs a calendar chosen', () => {
    expect(calendarNotice('connected')).toEqual({
      kind: 'notice',
      message: 'Google is connected. Choose which calendar this room should use.',
    });
  });

  it('does not call cancelling an error', () => {
    expect(calendarNotice('canceled')?.kind).toBe('notice');
  });

  it('reports a failed exchange as an error', () => {
    expect(calendarNotice('error')?.kind).toBe('error');
  });

  it('says nothing when the page was not reached from Google', () => {
    expect(calendarNotice(null)).toBeNull();
  });
});

/**
 * What state a room's Google Calendar is in, and what to say about it.
 *
 * Split out of the component because the distinction it draws is the whole
 * point and is worth pinning down: connecting an account and choosing a
 * calendar are two different steps. Nothing ever set `googleCalendarId`, so
 * five call sites read `room.googleCalendarId || 'primary'` and every one
 * resolved to the personal calendar of whoever pressed Connect (SPC-07).
 */
export type CalendarState = 'disconnected' | 'connected' | 'syncing';

export function calendarState(room: {
  googleCalendarId?: string | null;
  googleAccountEmail?: string | null;
}): CalendarState {
  // A calendar id is proof of both: it can only be set through a connected
  // account. The account address alone means consent was given and the
  // question of which calendar has not been answered yet.
  if (room.googleCalendarId) return 'syncing';
  if (room.googleAccountEmail) return 'connected';
  return 'disconnected';
}

/** What to tell an admin Google has just sent back to the rooms page. */
export function calendarNotice(
  result: string | null,
): { kind: 'notice' | 'error'; message: string } | null {
  switch (result) {
    case 'connected':
      // Deliberately not "done": a calendar still has to be chosen, and
      // saying otherwise would leave rooms connected to nothing.
      return {
        kind: 'notice',
        message: 'Google is connected. Choose which calendar this room should use.',
      };
    case 'canceled':
      // Stopping at Google's consent screen is a choice, not a failure.
      return { kind: 'notice', message: 'No calendar was connected.' };
    case 'error':
      return {
        kind: 'error',
        message: 'Google did not complete the connection. Nothing was changed — try again.',
      };
    default:
      return null;
  }
}

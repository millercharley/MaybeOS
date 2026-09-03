/**
 * Print the calendar entry a booking produces, without a Google account.
 *
 * Written because the only way to see what the room's calendar would say was
 * to make a real booking against a real connected calendar and go and look —
 * which is how "Attic" against a three-hour block survived (SPC-15).
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/preview-calendar-entry.ts
 */
import { eventDescription, eventSummary } from '../src/modules/calendar/event-content';

const booking = {
  title: 'Working Craft Mtg',
  description: 'Getting ready for an upcoming event. Team meeting, mixer, and craft day.',
  memberName: 'Stephanie M Collins',
  memberEmail: 'collins.stephanie09@example.org',
  visibility: 'PRIVATE' as const,
  expectedAttendance: 15,
  hasCost: false,
  categories: ['Art or expression', 'Organising or meetings'],
  needsApproval: true,
};

const room = { name: '3rd Floor Attic', address: '1425 Story Ave, Louisville, KY' };

console.log('── Summary ──');
console.log(eventSummary(booking, room));
console.log('\n── Description ──');
console.log(
  eventDescription(booking, room, {
    bookings: 'https://maybeos.org/member/maybeitsfate/bookings',
  }),
);

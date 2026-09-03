/**
 * What a booking looks like on the room's Google Calendar (SPC-21).
 *
 * It used to be the room's own name against a three-hour block — the booking
 * screen sent `title: room.name`, so the calendar read "Attic" and an
 * organiser walking past learned nothing about who was in there or why. The
 * calendar is where a co-op actually looks, and often the only place someone
 * not in MaybeOS looks at all.
 *
 * Pure, so the wording can be exercised without a Google account. Every field
 * is optional at the edges because a booking made before SPC-21 has none of
 * them, and those must still render as something a person can read.
 */

export interface BookingForCalendar {
  title: string;
  description?: string | null;
  memberName?: string | null;
  memberEmail?: string | null;
  visibility?: 'PUBLIC' | 'MEMBERS_ONLY' | 'PRIVATE' | null;
  expectedAttendance?: number | null;
  hasCost?: boolean | null;
  categories?: string[] | null;
  needsApproval?: boolean;
}

export interface RoomForCalendar {
  name: string;
  /** Where the room physically is, if the co-op has recorded it. */
  address?: string | null;
}

export interface ManageLinks {
  /** The member's own bookings page, where reschedule and cancel live. */
  bookings?: string | null;
}

const VISIBILITY: Record<string, string> = {
  PUBLIC: 'Open to the public',
  MEMBERS_ONLY: 'Open to members',
  PRIVATE: 'Private to their guests',
};

/**
 * The one line an organiser reads in a day view.
 *
 * Who, then what: a calendar full of "Attic" tells you only that the Attic is
 * busy, which the block itself already said.
 */
export function eventSummary(booking: BookingForCalendar, room: RoomForCalendar): string {
  const who = booking.memberName?.trim();
  const what = booking.title?.trim() || room.name;

  // A booking whose title is just the room's name — every one made before
  // SPC-21 — reads as "Maya Chen · Attic" rather than "Attic · Attic".
  const subject = what.toLowerCase() === room.name.toLowerCase() ? room.name : `${what} · ${room.name}`;

  return who ? `${who} · ${subject}` : subject;
}

/**
 * The detail, as plain text.
 *
 * Google renders a limited set of HTML in descriptions and mangles the rest,
 * and this is read as often in a notification as in the web UI. Lines are
 * labelled rather than run together so it stays scannable on a phone.
 */
export function eventDescription(
  booking: BookingForCalendar,
  room: RoomForCalendar,
  links: ManageLinks = {},
): string {
  const lines: string[] = [];

  const push = (label: string, value: string | null | undefined) => {
    if (value) lines.push(`${label}\n${value}\n`);
  };

  push('Room', room.address ? `${room.name}, ${room.address}` : room.name);
  push('Booked by', booking.memberName?.trim() || null);

  // The title is skipped when it is only the room's name again, which is what
  // every booking made before SPC-21 carries.
  const title = booking.title?.trim();
  if (title && title.toLowerCase() !== room.name.toLowerCase()) {
    push('What', title);
  }

  push('Description', booking.description?.trim() || null);
  push('Who it is open to', booking.visibility ? VISIBILITY[booking.visibility] : null);
  push(
    'Expected size',
    typeof booking.expectedAttendance === 'number'
      ? `About ${booking.expectedAttendance} ${booking.expectedAttendance === 1 ? 'person' : 'people'}`
      : null,
  );

  // Only said when it is true. "Cost to attend: No" on every entry is noise
  // that trains people to stop reading the description.
  if (booking.hasCost) push('Cost to attend', 'Yes — ask the organiser');

  push('Kind of gathering', booking.categories?.length ? booking.categories.join(', ') : null);

  if (booking.needsApproval) {
    push('Status', 'Waiting on an organiser — not confirmed yet');
  }

  if (links.bookings) {
    lines.push(`Reschedule or cancel\n${links.bookings}\n`);
  }

  lines.push('Booked through MaybeOS.');

  return lines.join('\n');
}

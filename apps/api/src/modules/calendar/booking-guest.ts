/**
 * Who a room was actually booked for (SPC-25).
 *
 * A co-op's room calendar is kept by whatever account its booking automation
 * runs on, so every entry on it has the same creator. MaybeItsFate's import
 * read that creator, matched it to an organiser, and handed one person 3,017
 * reservations; marking them all as the co-op's then left the real bookers
 * with nothing.
 *
 * Both were wrong, and the answer was in the entry the whole time. The
 * automation writes the person into the description:
 *
 *     Event • 3rd Floor Attic
 *     Location • 1425 Story Ave
 *     Guest • Abby Ferree (abby.m.ferree@gmail.com)
 *
 * 2,348 of MaybeItsFate's 3,017 reservations carry that line, naming 216
 * different people. The creator never varied; this does.
 *
 * Deliberately conservative. It reads an address only from a line that says
 * whose booking it is — not the first address anywhere in the text, which on
 * a room calendar is as likely to be the co-op's contact address at the foot
 * of a template as it is to be the booker.
 */

/** Labels a booking tool uses for the person it is holding the room for. */
const LABELS = ['guest', 'booked by', 'booked for', 'reserved by', 'reserved for', 'host'];

const EMAIL = '[^\\s<>()\\[\\]]+@[^\\s<>()\\[\\]]+\\.[a-z]{2,}';

export interface BookingGuest {
  email: string;
  name: string | null;
}

export function guestFrom(description: string | null | undefined): BookingGuest | null {
  const text = (description ?? '').trim();
  if (!text) return null;

  for (const line of text.split(/\r?\n/)) {
    const label = LABELS.find((l) => new RegExp(`^\\s*${l}\\b`, 'i').test(line));
    if (!label) continue;

    // The address, and whatever came before it on the line as the name.
    const found = line.match(new RegExp(`(${EMAIL})`, 'i'));
    if (!found) continue;

    const email = found[1].toLowerCase().replace(/[.,;]+$/, '');
    const before = line
      .slice(0, found.index ?? 0)
      // Drop the label and whatever separates it from the name: a bullet, a
      // colon, a dash. MaybeItsFate's is "Guest • ".
      .replace(new RegExp(`^\\s*${label}\\b`, 'i'), '')
      .replace(/^[\s•:·\-–—]+/, '')
      .replace(/[\s(<]+$/, '')
      .trim();

    return { email, name: before === '' ? null : before };
  }

  return null;
}

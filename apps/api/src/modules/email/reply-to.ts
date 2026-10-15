/**
 * Where a member's reply goes (EML-03).
 *
 * Every MaybeOS message was no-reply mail by construction: `noreply@` with no
 * `Reply-To`, so a member who answered one was answering nobody. That is both
 * discourteous and a small negative signal to the filters deciding whether
 * this domain corresponds to anybody real.
 *
 * The address is the **co-op's**, not the platform's, and is typed by an
 * organiser in Settings. No address MaybeOS could choose for them would be
 * right: a member replying to MaybeItsFate wants MaybeItsFate.
 *
 * Null is a real answer rather than a missing one. A co-op with nobody to
 * read replies is better served by no `Reply-To` at all — the member's own
 * client then tells them immediately that this is not a conversation, which
 * beats being ignored.
 */

/** RFC 5321's limit on a whole address. */
const MAX_LENGTH = 254;

/**
 * Deliberately stricter than what RFC 5322 permits.
 *
 * Quoted local parts and address literals are legal and essentially never
 * typed by an organiser into a settings field, while every one of them is a
 * character this value must not carry into a header. Refusing them costs a
 * co-op nothing real and removes a class of input entirely.
 */
const PLAIN_ADDRESS = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

/**
 * The address to put in `Reply-To`, or null to send none.
 *
 * **Refuses rather than repairs.** The From display name is stripped of
 * control characters because a co-op whose name has a stray tab should still
 * get its mail out — a name is prose. An address is not: a newline in one is
 * not a typo an organiser made, it is somebody trying to add headers to every
 * message this co-op sends, and the right answer is to send none.
 */
export function safeReplyTo(value: string | null | undefined): string | null {
  const address = (value ?? '').trim();
  if (!address) return null;
  if (address.length > MAX_LENGTH) return null;

  // Checked explicitly rather than left to the pattern above. The pattern
  // would reject these anyway; saying so here means the reason survives
  // somebody later relaxing it.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(address)) return null;

  // One address. `Reply-To` may legally carry a list, and a settings field
  // offering one is a field somebody pastes a mailing list into.
  if (address.includes(',') || address.includes(';')) return null;

  return PLAIN_ADDRESS.test(address) ? address : null;
}

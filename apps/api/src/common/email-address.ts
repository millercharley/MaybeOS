/**
 * One spelling of an email address (AUTH-07).
 *
 * A member of MaybeItsFate signed in, typed their own address with a capital
 * letter, and MaybeOS did not recognise them. It offered to start a co-op
 * instead, so they did — and ended up with two accounts, two passwords, and a
 * duplicate of their own community.
 *
 * Nothing had gone wrong by the code's own account. `users.email` is unique
 * and case-sensitive, and `Jonleecope@bellsouth.net` is genuinely not
 * `jonleecope@bellsouth.net`. RFC 5321 even agrees: the local part is
 * case-sensitive, and a server is within its rights to treat the two as
 * different people.
 *
 * No mail provider anybody uses does that. Treating them as different people
 * is correct and useless.
 *
 * **Deliberately not clever**: no stripping of Gmail dots, no collapsing of
 * `+` aliases. Those rules are true of some providers and false of others,
 * and a wrong merge joins two people's accounts — worse in kind than leaving
 * two rows for somebody to look at.
 */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * The same, but preserving "there was nothing here".
 *
 * An absent address and an empty one mean different things on a membership —
 * `altEmail` is null for most members and that is not the same as blank — so
 * a caller storing one needs null back rather than `''`.
 */
export function normalizeEmailOrNull(email: string | null | undefined): string | null {
  return normalizeEmail(email) || null;
}

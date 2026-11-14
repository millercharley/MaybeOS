/**
 * How long a password has to be (AUTH-04, AUTH-09).
 *
 * One number, in one place, because three screens now ask for a password —
 * settings, the create-password offer after a sign-in link, and the reset form
 * — and the API enforces its own floor in two DTOs. Five copies of "8" is four
 * chances for one of them to drift more permissive than the server and start
 * refusing things on the server's behalf, or less permissive and let a member
 * type something the API then rejects.
 *
 * It mirrors `MIN_PASSWORD_LENGTH` in the API's `password-reset.ts`, which is
 * the authority — the browser cannot be, since it is the side that can be
 * skipped. Kept in step by a test that reads both.
 *
 * Eight is a floor rather than a policy. Length is what actually resists an
 * offline attack on a stolen hash, which is the situation these screens exist
 * for; a rule demanding a capital and a digit buys less and is obeyed by
 * putting "1" and "A" on the end.
 */
export const MIN_PASSWORD = 8;

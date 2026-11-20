/**
 * The cap on the call to action, in one place (SOC-05).
 *
 * Charley asked for "a cap on the amount of text" on the image. His own is 54
 * characters; 80 is two comfortable lines at the footer's size, past which it
 * stops being a call to action and becomes a paragraph.
 *
 * It lives here rather than in the DTO because three things enforce it — the
 * form, the API and the renderer — and three copies of a number is how they
 * come to disagree. The renderer is the one that cannot be skipped; the other
 * two exist so a co-op is told at the form rather than finding its words
 * quietly cut a week later.
 *
 * The web app keeps its own copy because the two packages do not share code,
 * and `weekly-cta.spec.ts` reads this file from there to prove they agree.
 * That is the best a workspace boundary allows: not one definition, but a
 * test that fails the moment there are two different ones.
 */
export const CTA_LIMIT = 80;

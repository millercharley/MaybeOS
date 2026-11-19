/**
 * Who may sign in with a password, and who must prove their address first
 * (AUTH-10).
 *
 * MaybeOS production, 19 November 2026: 33 accounts belonged to no co-op,
 * and about twenty of them were one bot. Two signatures gave it away —
 * Gmail dot-aliasing and generated names. Gmail ignores dots in the local
 * part, so `a.b.c` and `abc` at the same Gmail domain are one mailbox — and
 * `normalizeEmail` only lowercases, so MaybeOS reads them as two people and
 * each passes the "already exists" check. One inbox, unlimited accounts.
 * Two or three a week since 18 October, still arriving.
 *
 * The addresses themselves are not quoted here on purpose: this repository
 * is public, and the source-address scan is right to refuse them. They are
 * in the 19 November report.
 *
 * The mechanism was two lines. `POST /auth/register` ended with
 * `return this.authService.login(user)` — **signed in at the moment of
 * creation** — and nothing anywhere read `emailVerified`. An address nobody
 * had proved got a working account immediately.
 *
 * ## Why this is not simply "require emailVerified to sign in"
 *
 * Because that would have locked out most of MaybeItsFate. Counted before
 * any of this was written: **303 of 496 users are unverified, and 271 of
 * them belong to a co-op** — an imported roster has not proved anything,
 * and never needed to.
 *
 * What makes a safe rule possible is a second number from the same query:
 * unverified users holding a password, **53**; unverified users who have
 * signed in, **53**. The same people. Every existing account that could be
 * affected by a password rule has already signed in at least once, so
 * grandfathering on "has signed in before" locks out nobody at all, while a
 * freshly farmed account — created, never used — is refused.
 *
 * The rule is therefore about what an account has *done*, not when it was
 * made. No migration, no cutover date, and nothing to get wrong on a
 * backfill.
 */

export interface SigninCandidate {
  emailVerified: boolean;
  /** Null for an account that has never been used. Written by `login`. */
  lastLoginAt: Date | null;
}

/**
 * Whether this account still owes us proof that the address is theirs.
 *
 * Deliberately evaluated **after** the password has been checked, so it
 * discloses nothing: whoever reaches this point already holds working
 * credentials, and telling them to check their email reveals nothing a
 * successful sign-in would not have.
 */
export function mustProveAddress(user: SigninCandidate): boolean {
  if (user.emailVerified) return false;

  // Signed in before, so it predates this rule. See the counts above: this
  // clause is the whole reason nobody is locked out.
  return user.lastLoginAt === null;
}

/** Said to somebody who registered and has not clicked the link yet. */
export const PROVE_ADDRESS_MESSAGE =
  'Check your email — there is a link there that finishes setting up your account. ' +
  'If it has not arrived, ask for a new one from the sign-in page.';

export interface InviteProof {
  email: string;
  expiresAt: Date;
  acceptedAt?: Date | null;
}

/**
 * Whether an invitation proves the address being registered.
 *
 * An invitation is *emailed* to one address, so holding its token is the
 * same evidence a magic link gives. Without this, inviting somebody would
 * cost them two emails and two round trips: they click the invitation, land
 * on register, and are told to go and find another message.
 *
 * It proves only the address it was sent to — `dto.email` must match, or a
 * forwarded invitation would verify a stranger's address instead. That is
 * the one way this could become a hole of its own.
 */
export function inviteProves(
  invitation: InviteProof | null | undefined,
  email: string,
  now: Date = new Date(),
): boolean {
  if (!invitation) return false;
  if (invitation.acceptedAt) return false;
  if (invitation.expiresAt <= now) return false;

  return invitation.email === email;
}

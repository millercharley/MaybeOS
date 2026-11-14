-- AUTH-09: a forgotten password is recoverable.
--
-- `sendMagicLink` has carried the note since AUTH-02: "With no password reset
-- either, that made a forgotten password unrecoverable." A sign-in link was
-- the whole answer, which works, and which asks somebody who knows they have
-- a password to go and do something else instead.
--
-- Its own column pair rather than reusing magicLinkToken/magicLinkExpiry. The
-- two are the same shape and sharing them would mean a token issued to *sign
-- in* could be redeemed at the *set a password* form and the other way round
-- — a credential doing a job it was not issued for. It would also mean asking
-- for a sign-in link cancelled a reset somebody was halfway through, and that
-- bug reads as an email that never arrived.
--
-- What is stored is a sha256 of the token; the only copy of the token itself
-- goes in the email. This is the one credential on `users` where reading a
-- single column would otherwise mean permanently changing somebody's
-- password. `password-reset.ts` says why the magic-link token has not been
-- moved to match: that is a change to the sign-in path 433 of MaybeItsFate's
-- members depend on, and it does not belong in this feature.
ALTER TABLE "users" ADD COLUMN "passwordResetToken" TEXT;
ALTER TABLE "users" ADD COLUMN "passwordResetExpiry" TIMESTAMP(3);

-- The redemption path looks a row up by this and nothing else, once, while
-- somebody waits on a form.
CREATE INDEX "users_passwordResetToken_idx" ON "users"("passwordResetToken");

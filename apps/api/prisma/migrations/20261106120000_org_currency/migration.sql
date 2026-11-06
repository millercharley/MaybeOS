-- PUB-01: a co-op's membership tiers carry a currency, like its events do.
--
-- The website embed renders tier prices through Intl.NumberFormat, and until
-- now it passed a hardcoded 'usd' at all three membership call sites while the
-- event card beside them passed `event.currency`. MaybeItsFate bills in
-- dollars so nothing was visibly wrong; the point is that a co-op that does
-- not use dollars should not be shipped a dollar sign by a view that had no
-- way to know better.
--
-- On the organization rather than the tier: an event is priced in whatever its
-- ticket is sold in, but a co-op collects dues in one currency, and a tier
-- list whose cards disagree is unreadable.
--
-- The default is 'usd' on purpose, and it is more than convenience: every
-- existing row means dollars, and dues checkout still names 'usd' inline in
-- stripe.service.ts. Until that reads this column, the only honest value here
-- is the default, and the column's job is to give the render path one place to
-- read instead of three places to forget.
ALTER TABLE "organizations"
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'usd';

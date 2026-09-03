-- EVT-17: an event can cost something without selling a ticket.
--
-- `priceCents` means a ticket sold through MaybeOS. Most co-op events that
-- charge do not do that — the figure-drawing night asks $20 at the door,
-- payable in cash or Venmo — and an event page that says nothing about money
-- because no ticket exists is telling people it is free.
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "hasCost" BOOLEAN NOT NULL DEFAULT false;

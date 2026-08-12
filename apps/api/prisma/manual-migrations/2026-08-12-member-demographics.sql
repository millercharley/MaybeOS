-- IMP-17: the demographic profile gets somewhere to live.
--
-- PRD §6.4: demographic segments are collected once, in a dedicated profile
-- section, never inside impact micro-surveys. §10 makes the data member-owned
-- — viewable, editable and deletable at any time, with deletion propagating
-- to future reports.
--
-- Scoped to the membership rather than the user: orgs are firewalled (D-020),
-- and what somebody is willing to tell one co-op is not consent to tell
-- another.
--
-- NULL means never answered. An absent key inside the object means that field
-- was skipped, which is different from "prefer not to say" — only one of those
-- is a signal, and the reports treat them differently.
--
-- Additive and nullable: safe to apply before the code that writes it.

ALTER TABLE "user_orgs" ADD COLUMN "demographics" JSONB;

-- IMP-23 phase 2: whether a written report's prose has been written yet.
--
-- The written report is the free report with better sentences over the same
-- frozen figures, so it is readable from the moment it exists. This only says
-- whether the rewriting has happened — and FAILED is a survivable state, not
-- an error: the co-op keeps the deterministic text, which is flat and true.

CREATE TYPE "ComposeStatus" AS ENUM ('NOT_NEEDED', 'PENDING', 'COMPOSING', 'READY', 'FAILED');

-- Existing reports are all the free kind and need no prose written.
ALTER TABLE "impact_reports"
  ADD COLUMN IF NOT EXISTS "composeStatus" "ComposeStatus" NOT NULL DEFAULT 'NOT_NEEDED',
  ADD COLUMN IF NOT EXISTS "composeNote"   TEXT,
  ADD COLUMN IF NOT EXISTS "composedAt"    TIMESTAMP(3);

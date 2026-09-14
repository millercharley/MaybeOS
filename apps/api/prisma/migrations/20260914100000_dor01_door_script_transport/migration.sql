-- DOR-01: door codes go to the co-op's Apps Script web app, not the Sheets API.
--
-- MaybeOS no longer needs access to the spreadsheet. It signs a request to the
-- script that owns the sheet, using a secret sealed with secret-box.
-- `doorSheetId` stays in place, unread; dropping a column in production is a
-- separate decision.
--
-- `door_sheet_entries` records what MaybeOS last wrote for each email, so a
-- member who leaves the co-op can still be marked revoked after their
-- membership row is gone.
--
-- Row-level security on the new table and no grants to anon or authenticated,
-- matching every other application table.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "doorScriptUrl" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "doorScriptSecret" JSONB;

CREATE TABLE IF NOT EXISTS "door_sheet_entries" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "doorPin" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "revoked" BOOLEAN NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "door_sheet_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "door_sheet_entries_orgId_email_key" ON "door_sheet_entries"("orgId", "email");

DO $$ BEGIN
  ALTER TABLE "door_sheet_entries"
    ADD CONSTRAINT "door_sheet_entries_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "door_sheet_entries" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "door_sheet_entries" FROM anon, authenticated;

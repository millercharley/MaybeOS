-- EVT-43: which band of an event's picture to keep when it is cropped.
--
-- Every frame the art appears in is wider than it is tall, so a portrait
-- photograph loses its top and bottom — and the subject is usually a person,
-- whose head is at the top. 50 is the middle, which is what every existing
-- event already shows.
ALTER TABLE "events" ADD COLUMN "imageFocusY" INTEGER NOT NULL DEFAULT 50;

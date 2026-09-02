-- SPC-10: every room can carry a photo.
--
-- `imageUrl` has been on the table since SpaceOS was built and nothing has
-- ever written to it or read from it — no room in any environment has a value.
-- Renamed rather than reused: the column holds a private storage key, and
-- calling a key a URL is what led to article covers being served publicly the
-- first time round (BEL-05).
ALTER TABLE "rooms" RENAME COLUMN "imageUrl" TO "imagePath";

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "bookingId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "events_bookingId_key" ON "events"("bookingId");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;


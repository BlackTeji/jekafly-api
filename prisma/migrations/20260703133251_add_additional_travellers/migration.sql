-- AlterTable
ALTER TABLE "holiday_bookings" ADD COLUMN     "additionalTravellers" JSONB;

-- AlterTable
ALTER TABLE "holiday_dates" ADD COLUMN     "endDate" TIMESTAMP(3);

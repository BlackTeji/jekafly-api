-- CreateEnum
CREATE TYPE "HolidayCategory" AS ENUM ('LOCAL', 'INTERNATIONAL');

-- CreateEnum
CREATE TYPE "HolidayOccupancy" AS ENUM ('SINGLE', 'SHARING');

-- AlterTable
ALTER TABLE "holidays" ADD COLUMN     "category" "HolidayCategory" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "price" INTEGER,
ADD COLUMN     "priceSingle" INTEGER,
ADD COLUMN     "priceSharing" INTEGER,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "tier" DROP NOT NULL;

-- AlterTable
ALTER TABLE "holiday_bookings" ADD COLUMN     "occupancy" "HolidayOccupancy",
ADD COLUMN     "unitPrice" INTEGER,
ALTER COLUMN "tier" DROP NOT NULL;

-- Backfill: carry each package's own-tier price into the new standard price
UPDATE "holidays" SET "price" = CASE "tier"
    WHEN 'EXPLORER' THEN "priceExplorer"
    WHEN 'SIGNATURE' THEN "priceSignature"
    WHEN 'EXECUTIVE' THEN "priceExecutive"
END
WHERE "price" IS NULL;

-- CreateIndex
CREATE INDEX "holidays_category_idx" ON "holidays"("category");

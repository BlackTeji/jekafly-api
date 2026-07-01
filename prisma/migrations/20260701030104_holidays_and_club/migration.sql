-- CreateEnum
CREATE TYPE "HolidayTier" AS ENUM ('EXPLORER', 'SIGNATURE', 'EXECUTIVE');

-- CreateEnum
CREATE TYPE "HolidayStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "HolidayBookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClubMembershipStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentType" ADD VALUE 'HOLIDAY';
ALTER TYPE "PaymentType" ADD VALUE 'CLUB_MEMBERSHIP';

-- AlterTable
ALTER TABLE "pricing_config" ADD COLUMN     "clubMembershipFee" INTEGER NOT NULL DEFAULT 150000;

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "tier" "HolidayTier" NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "durationNights" INTEGER NOT NULL,
    "priceExplorer" INTEGER,
    "priceSignature" INTEGER,
    "priceExecutive" INTEGER,
    "experienceType" TEXT NOT NULL,
    "attractions" JSONB NOT NULL,
    "inclusions" JSONB NOT NULL,
    "images" JSONB NOT NULL DEFAULT '[]',
    "status" "HolidayStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday_dates" (
    "id" TEXT NOT NULL,
    "holidayId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 20,
    "bookedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday_bookings" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "holidayId" TEXT NOT NULL,
    "holidayDateId" TEXT NOT NULL,
    "tier" "HolidayTier" NOT NULL,
    "travellers" INTEGER NOT NULL,
    "leadName" TEXT NOT NULL,
    "leadEmail" TEXT NOT NULL,
    "leadPhone" TEXT,
    "tierAmount" INTEGER NOT NULL,
    "membershipAdded" BOOLEAN NOT NULL DEFAULT false,
    "membershipAmount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" INTEGER NOT NULL,
    "status" "HolidayBookingStatus" NOT NULL DEFAULT 'PENDING',
    "paymentRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holiday_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ClubMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "amountPaid" INTEGER NOT NULL,
    "paymentRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_perks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_perks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "holidays_region_idx" ON "holidays"("region");

-- CreateIndex
CREATE INDEX "holidays_tier_idx" ON "holidays"("tier");

-- CreateIndex
CREATE INDEX "holidays_status_idx" ON "holidays"("status");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_state_packageName_key" ON "holidays"("state", "packageName");

-- CreateIndex
CREATE INDEX "holiday_dates_holidayId_idx" ON "holiday_dates"("holidayId");

-- CreateIndex
CREATE INDEX "holiday_dates_date_idx" ON "holiday_dates"("date");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_bookings_ref_key" ON "holiday_bookings"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_bookings_paymentRef_key" ON "holiday_bookings"("paymentRef");

-- CreateIndex
CREATE INDEX "holiday_bookings_userId_idx" ON "holiday_bookings"("userId");

-- CreateIndex
CREATE INDEX "holiday_bookings_holidayId_idx" ON "holiday_bookings"("holidayId");

-- CreateIndex
CREATE INDEX "holiday_bookings_status_idx" ON "holiday_bookings"("status");

-- CreateIndex
CREATE INDEX "holiday_bookings_createdAt_idx" ON "holiday_bookings"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "club_memberships_userId_key" ON "club_memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "club_memberships_paymentRef_key" ON "club_memberships"("paymentRef");

-- CreateIndex
CREATE INDEX "club_memberships_userId_idx" ON "club_memberships"("userId");

-- CreateIndex
CREATE INDEX "club_memberships_status_idx" ON "club_memberships"("status");

-- CreateIndex
CREATE INDEX "club_memberships_expiryDate_idx" ON "club_memberships"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "club_perks_title_key" ON "club_perks"("title");

-- AddForeignKey
ALTER TABLE "holiday_dates" ADD CONSTRAINT "holiday_dates_holidayId_fkey" FOREIGN KEY ("holidayId") REFERENCES "holidays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_bookings" ADD CONSTRAINT "holiday_bookings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_bookings" ADD CONSTRAINT "holiday_bookings_holidayId_fkey" FOREIGN KEY ("holidayId") REFERENCES "holidays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_bookings" ADD CONSTRAINT "holiday_bookings_holidayDateId_fkey" FOREIGN KEY ("holidayDateId") REFERENCES "holiday_dates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_memberships" ADD CONSTRAINT "club_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

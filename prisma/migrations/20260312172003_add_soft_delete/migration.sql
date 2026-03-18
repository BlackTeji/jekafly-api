-- AlterEnum
ALTER TYPE "PaymentType" ADD VALUE 'CONSULTATION';

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "archivedUserId" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "passportIssueDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "fees" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "pricing_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "consultStandard" INTEGER NOT NULL DEFAULT 15000,
    "consultPriority" INTEGER NOT NULL DEFAULT 25000,
    "consultVip" INTEGER NOT NULL DEFAULT 50000,
    "insuranceBasic" INTEGER NOT NULL DEFAULT 25000,
    "insuranceStandard" INTEGER NOT NULL DEFAULT 45000,
    "insurancePremium" INTEGER NOT NULL DEFAULT 80000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_config_pkey" PRIMARY KEY ("id")
);

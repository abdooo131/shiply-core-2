-- CreateEnum
CREATE TYPE "CashOutStatus" AS ENUM ('prepared', 'approved', 'paid', 'canceled');

-- CreateTable
CREATE TABLE "CashCycle" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "cycleDate" DATE NOT NULL,
    "cashCollectedPiasters" INTEGER NOT NULL,
    "feesPiasters" INTEGER NOT NULL,
    "netPiasters" INTEGER NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cashOutId" UUID,

    CONSTRAINT "CashCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashCycleEntry" (
    "cycleId" UUID NOT NULL,
    "entryId" UUID NOT NULL,

    CONSTRAINT "CashCycleEntry_pkey" PRIMARY KEY ("cycleId","entryId")
);

-- CreateTable
CREATE TABLE "CashOut" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "merchantId" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "amountPiasters" INTEGER NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "status" "CashOutStatus" NOT NULL DEFAULT 'prepared',
    "preparedBy" UUID NOT NULL,
    "approvedBy" UUID,
    "paidBy" UUID,
    "bankReference" TEXT,
    "receiptPath" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashOut_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashCycle_cashOutId_idx" ON "CashCycle"("cashOutId");

-- CreateIndex
CREATE UNIQUE INDEX "CashCycle_merchantId_cycleDate_key" ON "CashCycle"("merchantId", "cycleDate");

-- CreateIndex
CREATE UNIQUE INDEX "CashCycleEntry_entryId_key" ON "CashCycleEntry"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "CashOut_number_key" ON "CashOut"("number");

-- CreateIndex
CREATE INDEX "CashOut_merchantId_status_idx" ON "CashOut"("merchantId", "status");

-- CreateIndex
CREATE INDEX "CashOut_status_scheduledDate_idx" ON "CashOut"("status", "scheduledDate");

-- AddForeignKey
ALTER TABLE "CashCycle" ADD CONSTRAINT "CashCycle_cashOutId_fkey" FOREIGN KEY ("cashOutId") REFERENCES "CashOut"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCycleEntry" ADD CONSTRAINT "CashCycleEntry_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "CashCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

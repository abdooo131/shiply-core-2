-- CreateTable
CREATE TABLE "LedgerAccount" (
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "orderId" UUID,
    "cashOutId" UUID,
    "merchantId" UUID,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerLine" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "accountCode" TEXT NOT NULL,
    "amountPiasters" INTEGER NOT NULL,

    CONSTRAINT "LedgerLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_merchantId_postedAt_idx" ON "LedgerEntry"("merchantId", "postedAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_orderId_idx" ON "LedgerEntry"("orderId");

-- CreateIndex
CREATE INDEX "LedgerLine_accountCode_idx" ON "LedgerLine"("accountCode");

-- CreateIndex
CREATE INDEX "LedgerLine_entryId_idx" ON "LedgerLine"("entryId");

-- AddForeignKey
ALTER TABLE "LedgerLine" ADD CONSTRAINT "LedgerLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerLine" ADD CONSTRAINT "LedgerLine_accountCode_fkey" FOREIGN KEY ("accountCode") REFERENCES "LedgerAccount"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

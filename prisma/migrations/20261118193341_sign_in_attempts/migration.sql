-- CreateTable
CREATE TABLE "SignInAttempt" (
    "id" UUID NOT NULL,
    "addressHash" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignInAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignInAttempt_addressHash_at_idx" ON "SignInAttempt"("addressHash", "at");

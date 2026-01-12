-- CreateEnum
CREATE TYPE "TransferType" AS ENUM ('P2P', 'MERCHANT', 'REFUND', 'CONTRACT_SETTLEMENT');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable: Add transferType to transfers
ALTER TABLE "transfers" ADD COLUMN "transferType" "TransferType" NOT NULL DEFAULT 'P2P';

-- AlterTable: Add contract reference fields to transfers
ALTER TABLE "transfers" ADD COLUMN "contractId" TEXT;
ALTER TABLE "transfers" ADD COLUMN "settlementId" TEXT;

-- CreateTable: settlements for ContractSim integration
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "settlementType" TEXT NOT NULL,
    "fromWalletId" TEXT NOT NULL,
    "fromBsimId" TEXT NOT NULL,
    "fromEscrowId" TEXT,
    "toWalletId" TEXT NOT NULL,
    "toBsimId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "metadata" JSONB,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "statusMessage" TEXT,
    "errorCode" TEXT,
    "transferId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "settlements_settlementId_key" ON "settlements"("settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_idempotencyKey_key" ON "settlements"("idempotencyKey");

-- CreateIndex
CREATE INDEX "settlements_contractId_idx" ON "settlements"("contractId");

-- CreateIndex
CREATE INDEX "settlements_status_idx" ON "settlements"("status");

-- CreateIndex
CREATE INDEX "settlements_idempotencyKey_idx" ON "settlements"("idempotencyKey");

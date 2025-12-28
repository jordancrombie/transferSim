-- CreateEnum
CREATE TYPE "AliasType" AS ENUM ('EMAIL', 'PHONE', 'USERNAME', 'RANDOM_KEY');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'RESOLVING', 'RECIPIENT_NOT_FOUND', 'DEBITING', 'DEBIT_FAILED', 'CREDITING', 'CREDIT_FAILED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'REVERSED');

-- CreateTable
CREATE TABLE "aliases" (
    "id" TEXT NOT NULL,
    "type" "AliasType" NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bsimId" TEXT NOT NULL,
    "accountId" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "senderBsimId" TEXT NOT NULL,
    "senderAccountId" TEXT NOT NULL,
    "senderAlias" TEXT,
    "recipientAlias" TEXT NOT NULL,
    "recipientAliasType" "AliasType" NOT NULL,
    "recipientUserId" TEXT,
    "recipientBsimId" TEXT,
    "recipientAccountId" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "description" TEXT,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "statusMessage" TEXT,
    "debitTransactionId" TEXT,
    "creditTransactionId" TEXT,
    "orchestratorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orchestrators" (
    "id" TEXT NOT NULL,
    "orchestratorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "canEnrollUsers" BOOLEAN NOT NULL DEFAULT true,
    "canInitiateTransfers" BOOLEAN NOT NULL DEFAULT true,
    "canViewTransfers" BOOLEAN NOT NULL DEFAULT true,
    "dailyTransferLimit" DECIMAL(15,2),
    "perTransferLimit" DECIMAL(15,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orchestrators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bsim_connections" (
    "id" TEXT NOT NULL,
    "bsimId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "authServerUrl" TEXT NOT NULL,
    "openBankingUrl" TEXT NOT NULL,
    "supportsPaymentInitiation" BOOLEAN NOT NULL DEFAULT false,
    "supportsInstantTransfer" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bsim_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_enrollments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bsimId" TEXT NOT NULL,
    "orchestratorId" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consentScopes" TEXT[],
    "consentExpiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "aliasId" TEXT,
    "userId" TEXT NOT NULL,
    "bsimId" TEXT NOT NULL,
    "amount" DECIMAL(15,2),
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "description" TEXT,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aliases_userId_bsimId_idx" ON "aliases"("userId", "bsimId");

-- CreateIndex
CREATE INDEX "aliases_normalizedValue_idx" ON "aliases"("normalizedValue");

-- CreateIndex
CREATE UNIQUE INDEX "aliases_type_normalizedValue_key" ON "aliases"("type", "normalizedValue");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_transferId_key" ON "transfers"("transferId");

-- CreateIndex
CREATE INDEX "transfers_senderUserId_senderBsimId_idx" ON "transfers"("senderUserId", "senderBsimId");

-- CreateIndex
CREATE INDEX "transfers_recipientUserId_recipientBsimId_idx" ON "transfers"("recipientUserId", "recipientBsimId");

-- CreateIndex
CREATE INDEX "transfers_status_idx" ON "transfers"("status");

-- CreateIndex
CREATE INDEX "transfers_transferId_idx" ON "transfers"("transferId");

-- CreateIndex
CREATE UNIQUE INDEX "orchestrators_orchestratorId_key" ON "orchestrators"("orchestratorId");

-- CreateIndex
CREATE UNIQUE INDEX "orchestrators_apiKey_key" ON "orchestrators"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "bsim_connections_bsimId_key" ON "bsim_connections"("bsimId");

-- CreateIndex
CREATE UNIQUE INDEX "user_enrollments_userId_bsimId_orchestratorId_key" ON "user_enrollments"("userId", "bsimId", "orchestratorId");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_tokenId_key" ON "tokens"("tokenId");

-- CreateIndex
CREATE INDEX "tokens_tokenId_idx" ON "tokens"("tokenId");

-- CreateIndex
CREATE INDEX "tokens_expiresAt_idx" ON "tokens"("expiresAt");

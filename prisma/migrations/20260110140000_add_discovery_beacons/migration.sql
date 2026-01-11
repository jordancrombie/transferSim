-- CreateEnum
CREATE TYPE "BeaconContext" AS ENUM ('P2P_RECEIVE', 'MERCHANT_RECEIVE');

-- CreateTable
CREATE TABLE "discovery_beacons" (
    "id" TEXT NOT NULL,
    "beaconToken" VARCHAR(8) NOT NULL,
    "major" INTEGER NOT NULL,
    "minor" INTEGER NOT NULL,
    "userId" VARCHAR(50) NOT NULL,
    "bsimId" VARCHAR(50) NOT NULL,
    "context" "BeaconContext" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "discovery_beacons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discovery_beacons_beaconToken_key" ON "discovery_beacons"("beaconToken");

-- CreateIndex
CREATE INDEX "discovery_beacons_beaconToken_idx" ON "discovery_beacons"("beaconToken");

-- CreateIndex
CREATE INDEX "discovery_beacons_expiresAt_idx" ON "discovery_beacons"("expiresAt");

-- CreateIndex
CREATE INDEX "discovery_beacons_userId_bsimId_idx" ON "discovery_beacons"("userId", "bsimId");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_beacons_major_minor_key" ON "discovery_beacons"("major", "minor");

-- Add BSIM user IDs to settlements table for credit/debit operations
-- These are the actual BSIM user IDs (distinct from ContractSim wallet IDs)

-- Add fromUserId column (required for new settlements)
ALTER TABLE "settlements" ADD COLUMN "fromUserId" TEXT;

-- Add toUserId column (required for new settlements)
ALTER TABLE "settlements" ADD COLUMN "toUserId" TEXT;

-- For existing settlements, we'll need to backfill these values
-- For now, set them to empty string to allow NOT NULL constraint later
-- In practice, existing settlements are already completed/failed so this is safe
UPDATE "settlements" SET "fromUserId" = '' WHERE "fromUserId" IS NULL;
UPDATE "settlements" SET "toUserId" = '' WHERE "toUserId" IS NULL;

-- Make columns required
ALTER TABLE "settlements" ALTER COLUMN "fromUserId" SET NOT NULL;
ALTER TABLE "settlements" ALTER COLUMN "toUserId" SET NOT NULL;

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../lib/prisma.js';
import { config } from '../config/index.js';
import { BsimClient } from '../services/bsimClient.js';
import { WsimClient } from '../services/wsimClient.js';
import { sendSettlementWebhook } from '../services/settlementWebhookService.js';

export const settlementRoutes = Router();

/**
 * Generate a unique settlement ID
 */
function generateSettlementId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `stl_${timestamp}${random}`;
}

/**
 * Generate a unique transfer ID for settlements
 */
function generateTransferId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `p2p_${timestamp}${random}`;
}

// Middleware to authenticate ContractSim service
function requireContractSimAuth(req: Request, res: Response, next: () => void): void {
  const apiKey = req.headers['x-api-key'] as string;

  if (!config.contractSim.apiKey) {
    console.warn('[Settlement] ContractSim API key not configured');
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'ContractSim integration not configured',
    });
    return;
  }

  if (!apiKey || apiKey !== config.contractSim.apiKey) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing API key',
    });
    return;
  }

  next();
}

// Validation schema for settlement request
const createSettlementSchema = z.object({
  contract_id: z.string().min(1),
  settlement_type: z.enum(['winner_payout', 'refund', 'partial', 'dispute_resolution']),

  from: z.object({
    wallet_id: z.string().min(1),
    bank_id: z.string().min(1),
    escrow_id: z.string().optional(),
  }),

  to: z.object({
    wallet_id: z.string().min(1),
    bank_id: z.string().min(1),
  }),

  amount: z.number().positive(),
  currency: z.string().default('CAD'),

  metadata: z.object({
    contract_title: z.string().optional(),
    original_stake: z.number().optional(),
    winnings: z.number().optional(),
    loser_display_name: z.string().optional(),
    winner_display_name: z.string().optional(),
  }).optional(),
});

/**
 * POST /api/v1/settlements - Create a new settlement transfer
 *
 * Called by ContractSim to execute winner payouts.
 * Requires Idempotency-Key header for safe retries.
 */
settlementRoutes.post('/', requireContractSimAuth, async (req: Request, res: Response) => {
  try {
    // Get idempotency key from header
    const idempotencyKey = req.headers['idempotency-key'] as string;
    if (!idempotencyKey) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Idempotency-Key header is required',
      });
      return;
    }

    // Check for existing settlement with this idempotency key
    const existingSettlement = await prisma.settlement.findUnique({
      where: { idempotencyKey },
    });

    if (existingSettlement) {
      // Return cached result
      console.log(`[Settlement] Returning cached result for idempotency key: ${idempotencyKey}`);
      res.status(existingSettlement.status === 'COMPLETED' ? 200 :
                 existingSettlement.status === 'FAILED' ? 422 : 202).json({
        settlement_id: existingSettlement.settlementId,
        transfer_id: existingSettlement.transferId,
        status: existingSettlement.status.toLowerCase(),
        amount: existingSettlement.amount.toString(),
        from_wallet_id: existingSettlement.fromWalletId,
        to_wallet_id: existingSettlement.toWalletId,
        completed_at: existingSettlement.completedAt?.toISOString() || null,
        error: existingSettlement.errorCode || undefined,
        error_message: existingSettlement.statusMessage || undefined,
      });
      return;
    }

    // Validate request body
    const body = createSettlementSchema.parse(req.body);

    // Create settlement record
    const settlement = await prisma.settlement.create({
      data: {
        settlementId: generateSettlementId(),
        idempotencyKey,
        contractId: body.contract_id,
        settlementType: body.settlement_type,
        fromWalletId: body.from.wallet_id,
        fromBsimId: body.from.bank_id,
        fromEscrowId: body.from.escrow_id,
        toWalletId: body.to.wallet_id,
        toBsimId: body.to.bank_id,
        amount: new Decimal(body.amount),
        currency: body.currency,
        metadata: body.metadata || undefined,
        status: 'PENDING',
      },
    });

    console.log(`[Settlement] Created settlement ${settlement.settlementId} for contract ${body.contract_id}`);

    // Process settlement synchronously (ContractSim expects result immediately)
    const result = await processSettlement(settlement.id);

    // Return result
    res.status(result.status === 'COMPLETED' ? 200 :
               result.status === 'FAILED' ? 422 : 202).json({
      settlement_id: result.settlementId,
      transfer_id: result.transferId,
      status: result.status.toLowerCase(),
      amount: result.amount,
      from_wallet_id: result.fromWalletId,
      to_wallet_id: result.toWalletId,
      completed_at: result.completedAt,
      error: result.errorCode,
      error_message: result.statusMessage,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid request body',
        details: error.errors,
      });
      return;
    }
    console.error('[Settlement] Create settlement error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create settlement',
    });
  }
});

/**
 * GET /api/v1/settlements/:settlementId - Get settlement status
 */
settlementRoutes.get('/:settlementId', requireContractSimAuth, async (req: Request, res: Response) => {
  try {
    const { settlementId } = req.params;

    const settlement = await prisma.settlement.findFirst({
      where: {
        OR: [
          { settlementId },
          { id: settlementId },
        ],
      },
    });

    if (!settlement) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Settlement not found',
      });
      return;
    }

    res.json({
      settlement_id: settlement.settlementId,
      contract_id: settlement.contractId,
      transfer_id: settlement.transferId,
      status: settlement.status.toLowerCase(),
      settlement_type: settlement.settlementType,
      amount: settlement.amount.toString(),
      currency: settlement.currency,
      from_wallet_id: settlement.fromWalletId,
      from_bank_id: settlement.fromBsimId,
      to_wallet_id: settlement.toWalletId,
      to_bank_id: settlement.toBsimId,
      metadata: settlement.metadata,
      created_at: settlement.createdAt.toISOString(),
      completed_at: settlement.completedAt?.toISOString() || null,
      error: settlement.errorCode || undefined,
      error_message: settlement.statusMessage || undefined,
    });
  } catch (error) {
    console.error('[Settlement] Get settlement error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get settlement',
    });
  }
});

/**
 * Process settlement - execute the actual transfer
 */
async function processSettlement(settlementId: string): Promise<{
  settlementId: string;
  transferId: string | null;
  status: string;
  amount: string;
  fromWalletId: string;
  toWalletId: string;
  completedAt: string | null;
  errorCode: string | null;
  statusMessage: string | null;
}> {
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
  });

  if (!settlement) {
    throw new Error('Settlement not found');
  }

  // Update status to processing
  await prisma.settlement.update({
    where: { id: settlementId },
    data: { status: 'PROCESSING' },
  });

  // Resolve wallet IDs to BSIM user IDs
  // For now, we assume wallet_id format is "WLLT-{userId}" or just use it directly
  // In production, WSIM would provide a lookup endpoint
  const fromUserId = extractUserIdFromWalletId(settlement.fromWalletId);
  const toUserId = extractUserIdFromWalletId(settlement.toWalletId);

  // Get metadata for description
  const metadata = settlement.metadata as {
    contract_title?: string;
    loser_display_name?: string;
    winner_display_name?: string;
  } | null;
  const description = metadata?.contract_title
    ? `Contract Settlement: ${metadata.contract_title}`
    : 'Contract Settlement';

  // Check if same-bank or cross-bank
  const isSameBank = settlement.fromBsimId === settlement.toBsimId;

  // Get BSIM clients
  const fromBsimClient = await BsimClient.forBsim(settlement.fromBsimId);
  const toBsimClient = isSameBank ? fromBsimClient : await BsimClient.forBsim(settlement.toBsimId);

  if (!fromBsimClient) {
    return await markSettlementFailed(settlementId, 'BANK_UNAVAILABLE', 'Source bank not configured');
  }

  if (!toBsimClient) {
    return await markSettlementFailed(settlementId, 'BANK_UNAVAILABLE', 'Destination bank not configured');
  }

  // Generate transfer ID
  const transferId = generateTransferId();

  // Create the transfer record first
  const transfer = await prisma.transfer.create({
    data: {
      transferId,
      senderUserId: fromUserId,
      senderBsimId: settlement.fromBsimId,
      senderAccountId: 'default', // Settlement uses default account
      recipientAlias: toUserId, // Using userId as alias for settlements
      recipientAliasType: 'USERNAME',
      recipientUserId: toUserId,
      recipientBsimId: settlement.toBsimId,
      amount: settlement.amount,
      currency: settlement.currency,
      description,
      transferType: 'CONTRACT_SETTLEMENT',
      recipientType: 'INDIVIDUAL',
      contractId: settlement.contractId,
      settlementId: settlement.settlementId,
      status: 'DEBITING',
    },
  });

  // Step 1: Debit from source (loser) or release escrow
  // If fromEscrowId is set, funds are held in escrow and we use escrow release
  // Otherwise, do a regular debit from the user's account
  if (settlement.fromEscrowId) {
    // Escrow-based settlement: release escrow (deduct from loser), then credit winner
    // NOTE: Escrow release only deducts - we must separately call credit()
    console.log(`[Settlement] Using escrow release for escrowId=${settlement.fromEscrowId}`);
    const escrowResult = await fromBsimClient.escrowRelease({
      escrowId: settlement.fromEscrowId,
      contractId: settlement.contractId,
      transferId: transfer.id,
      reason: description,
    });

    if (!escrowResult.success) {
      await prisma.transfer.update({
        where: { id: transfer.id },
        data: {
          status: 'DEBIT_FAILED',
          statusMessage: escrowResult.error || 'Escrow release failed',
        },
      });
      return await markSettlementFailed(settlementId, 'ESCROW_RELEASE_FAILED', escrowResult.error || 'Escrow release failed', transfer.transferId);
    }

    // Update transfer with escrow release transaction ID
    await prisma.transfer.update({
      where: { id: transfer.id },
      data: {
        debitTransactionId: escrowResult.transactionId,
        status: 'CREDITING',
      },
    });

    // Step 2: Credit to destination (winner) - same as non-escrow flow
    console.log(`[Settlement] Crediting winner ${toUserId} at ${settlement.toBsimId}`);
    const creditResult = await toBsimClient.credit({
      userId: toUserId,
      accountId: undefined, // Use default account
      amount: settlement.amount.toNumber(),
      currency: settlement.currency,
      transferId: transfer.id,
      description: `${description} - Credit`,
    });

    if (!creditResult.success) {
      // Credit failed after escrow release - funds are in limbo
      // TODO: Implement compensation (return funds to escrow or loser's account)
      await prisma.transfer.update({
        where: { id: transfer.id },
        data: {
          status: 'CREDIT_FAILED',
          statusMessage: creditResult.error || 'Credit failed',
        },
      });
      return await markSettlementFailed(settlementId, 'CREDIT_FAILED', creditResult.error || 'Credit failed (escrow released, needs compensation)', transfer.transferId);
    }

    // Mark transfer as completed
    await prisma.transfer.update({
      where: { id: transfer.id },
      data: {
        creditTransactionId: creditResult.transactionId,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
  } else {
    // Regular settlement: debit from user's account, then credit recipient
    console.log(`[Settlement] Using regular debit/credit flow (no escrow)`);
    const debitResult = await fromBsimClient.debit({
      userId: fromUserId,
      accountId: 'default',
      amount: settlement.amount.toNumber(),
      currency: settlement.currency,
      transferId: transfer.id,
      description: `${description} - Debit`,
    });

    if (!debitResult.success) {
      await prisma.transfer.update({
        where: { id: transfer.id },
        data: {
          status: 'DEBIT_FAILED',
          statusMessage: debitResult.error || 'Debit failed',
        },
      });
      return await markSettlementFailed(settlementId, 'DEBIT_FAILED', debitResult.error || 'Debit failed', transfer.transferId);
    }

    // Update transfer with debit transaction ID
    await prisma.transfer.update({
      where: { id: transfer.id },
      data: {
        debitTransactionId: debitResult.transactionId,
        status: 'CREDITING',
      },
    });

    // Step 2: Credit to destination (winner)
    const creditResult = await toBsimClient.credit({
      userId: toUserId,
      accountId: undefined, // Use default account
      amount: settlement.amount.toNumber(),
      currency: settlement.currency,
      transferId: transfer.id,
      description: `${description} - Credit`,
    });

    if (!creditResult.success) {
      // Credit failed - need to compensate by reversing debit
      // For now, mark as failed (saga compensation in Phase 2)
      await prisma.transfer.update({
        where: { id: transfer.id },
        data: {
          status: 'CREDIT_FAILED',
          statusMessage: creditResult.error || 'Credit failed',
        },
      });
      // TODO: Implement debit reversal
      return await markSettlementFailed(settlementId, 'CREDIT_FAILED', creditResult.error || 'Credit failed (debit may need reversal)', transfer.transferId);
    }

    // Mark transfer as completed for non-escrow flow
    await prisma.transfer.update({
      where: { id: transfer.id },
      data: {
        creditTransactionId: creditResult.transactionId,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
  }

  // Fetch profile images and update transfer
  let senderProfileImageUrl: string | null = null;
  let recipientProfileImageUrl: string | null = null;
  const wsimClient = WsimClient.create();
  if (wsimClient) {
    const [senderProfile, recipientProfile] = await Promise.all([
      wsimClient.getProfile(fromUserId, settlement.fromBsimId),
      wsimClient.getProfile(toUserId, settlement.toBsimId),
    ]);
    senderProfileImageUrl = senderProfile.profileImageUrl || null;
    recipientProfileImageUrl = recipientProfile.profileImageUrl || null;
  }

  // Update transfer with profile images and final status message
  const completedAt = new Date();
  await prisma.transfer.update({
    where: { id: transfer.id },
    data: {
      statusMessage: 'Settlement completed successfully',
      senderProfileImageUrl,
      recipientProfileImageUrl,
    },
  });

  // Update settlement status
  const completedSettlement = await prisma.settlement.update({
    where: { id: settlementId },
    data: {
      status: 'COMPLETED',
      statusMessage: 'Settlement completed successfully',
      transferId: transfer.transferId,
      completedAt,
    },
  });

  console.log(`[Settlement] Completed settlement ${settlement.settlementId}: ${settlement.amount} ${settlement.currency} for contract ${settlement.contractId}`);

  // Send webhook to ContractSim (fire-and-forget)
  sendSettlementWebhook({
    settlementId: settlement.settlementId,
    transferId: transfer.transferId,
    contractId: settlement.contractId,
    status: 'completed',
    amount: settlement.amount.toString(),
    fromWalletId: settlement.fromWalletId,
    toWalletId: settlement.toWalletId,
  }).catch((err) => {
    console.error('[Settlement] Failed to send webhook:', err);
  });

  return {
    settlementId: completedSettlement.settlementId,
    transferId: transfer.transferId,
    status: 'COMPLETED',
    amount: completedSettlement.amount.toString(),
    fromWalletId: completedSettlement.fromWalletId,
    toWalletId: completedSettlement.toWalletId,
    completedAt: completedAt.toISOString(),
    errorCode: null,
    statusMessage: null,
  };
}

/**
 * Mark settlement as failed
 */
async function markSettlementFailed(
  settlementId: string,
  errorCode: string,
  statusMessage: string,
  transferId?: string
): Promise<{
  settlementId: string;
  transferId: string | null;
  status: string;
  amount: string;
  fromWalletId: string;
  toWalletId: string;
  completedAt: string | null;
  errorCode: string | null;
  statusMessage: string | null;
}> {
  const settlement = await prisma.settlement.update({
    where: { id: settlementId },
    data: {
      status: 'FAILED',
      errorCode,
      statusMessage,
      transferId: transferId || null,
    },
  });

  console.error(`[Settlement] Failed settlement ${settlement.settlementId}: ${errorCode} - ${statusMessage}`);

  // Send failure webhook to ContractSim
  sendSettlementWebhook({
    settlementId: settlement.settlementId,
    transferId: transferId || null,
    contractId: settlement.contractId,
    status: 'failed',
    amount: settlement.amount.toString(),
    fromWalletId: settlement.fromWalletId,
    toWalletId: settlement.toWalletId,
    error: errorCode,
    errorMessage: statusMessage,
  }).catch((err) => {
    console.error('[Settlement] Failed to send failure webhook:', err);
  });

  return {
    settlementId: settlement.settlementId,
    transferId: transferId || null,
    status: 'FAILED',
    amount: settlement.amount.toString(),
    fromWalletId: settlement.fromWalletId,
    toWalletId: settlement.toWalletId,
    completedAt: null,
    errorCode,
    statusMessage,
  };
}

/**
 * Extract user ID from wallet ID
 * Wallet ID format: "WLLT-{userId}" or just userId
 */
function extractUserIdFromWalletId(walletId: string): string {
  if (walletId.startsWith('WLLT-')) {
    return walletId.substring(5);
  }
  return walletId;
}

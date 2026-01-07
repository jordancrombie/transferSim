import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { normalizeAlias } from '../utils/normalize.js';
import { generateTransferId } from '../utils/id.js';
import { AliasType, TransferStatus } from '@prisma/client';
import { config } from '../config/index.js';
import { BsimClient } from '../services/bsimClient.js';
import { sendTransferCompletedWebhook, buildTransferCompletedPayload } from '../services/webhookService.js';
import { calculateFee } from './micro-merchants.js';

export const transferRoutes = Router();

// Helper to send transfer completed notification webhook
async function sendTransferCompletedNotification(params: {
  transferId: string;
  senderUserId: string;
  senderBsimId: string;
  recipientUserId: string;
  recipientBsimId: string;
  recipientAlias: string;
  recipientAliasType: AliasType;
  amount: string;
  currency: string;
  description: string | null;
  isCrossBank: boolean;
}): Promise<void> {
  try {
    // Fetch sender's display name from BSIM
    let senderDisplayName = 'Unknown';
    const senderBsimClient = await BsimClient.forBsim(params.senderBsimId);
    if (senderBsimClient) {
      const verifyResult = await senderBsimClient.verifyUser({ userId: params.senderUserId });
      if (verifyResult.exists && verifyResult.displayName) {
        senderDisplayName = verifyResult.displayName;
      }
    }

    // Fetch sender's primary alias
    const senderAlias = await prisma.alias.findFirst({
      where: {
        userId: params.senderUserId,
        bsimId: params.senderBsimId,
        isActive: true,
        isPrimary: true,
      },
    });

    // Fetch bank names
    const [senderBank, recipientBank] = await Promise.all([
      prisma.bsimConnection.findUnique({ where: { bsimId: params.senderBsimId } }),
      prisma.bsimConnection.findUnique({ where: { bsimId: params.recipientBsimId } }),
    ]);

    // Build and send webhook
    const payload = buildTransferCompletedPayload({
      transferId: params.transferId,
      recipientUserId: params.recipientUserId,
      recipientBsimId: params.recipientBsimId,
      recipientAlias: params.recipientAlias,
      recipientAliasType: params.recipientAliasType,
      senderDisplayName,
      senderAlias: senderAlias?.value || null,
      senderBankName: senderBank?.name || 'Unknown Bank',
      recipientBankName: recipientBank?.name || 'Unknown Bank',
      amount: params.amount,
      currency: params.currency,
      description: params.description,
      isCrossBank: params.isCrossBank,
    });

    await sendTransferCompletedWebhook(payload);
  } catch (error) {
    // Log error but don't fail the transfer - notification is fire-and-forget
    console.error(`[Webhook] Error preparing notification for transfer ${params.transferId}:`, error);
  }
}

// Validation schemas
// Accept multiple field names for account ID due to naming inconsistency across docs
// Canonical: senderAccountId (matches DB schema and original design)
// Also accepts: fromAccountId, sourceAccountId (for backward compatibility)
const createTransferSchema = z
  .object({
    recipientAlias: z.string().min(1),
    recipientAliasType: z.enum(['EMAIL', 'PHONE', 'USERNAME', 'RANDOM_KEY']).optional(),
    amount: z.number().positive(),
    currency: z.string().default('CAD'),
    description: z.string().max(200).optional(),
    // Accept all three field names for backward compatibility
    senderAccountId: z.string().optional(), // Canonical name (matches DB schema)
    fromAccountId: z.string().optional(), // Legacy name from initial implementation
    sourceAccountId: z.string().optional(), // Name from mwsim integration proposal
    senderBsimId: z.string().optional(), // Multi-bank support: explicitly specify which bank to debit from
  })
  .refine(
    (data) => data.senderAccountId || data.fromAccountId || data.sourceAccountId,
    {
      message: 'One of senderAccountId, fromAccountId, or sourceAccountId is required',
      path: ['senderAccountId'],
    }
  );

// Accept both 'type' and 'direction' for filtering (mwsim uses 'direction')
const listTransfersSchema = z.object({
  type: z.enum(['sent', 'received', 'all']).optional(),
  direction: z.enum(['sent', 'received', 'all']).optional(), // Alias for 'type' (mwsim compatibility)
  status: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  offset: z.coerce.number().min(0).optional().default(0),
});

// POST /api/v1/transfers - Initiate P2P transfer
transferRoutes.post('/', requireAuth, requirePermission('canInitiateTransfers'), async (req: Request, res: Response) => {
  try {
    const body = createTransferSchema.parse(req.body);
    const user = req.user!;
    const orchestrator = req.orchestrator!;

    // Validate amount against limits
    if (body.amount > config.limits.defaultTransferLimit) {
      res.status(400).json({
        error: 'Bad Request',
        message: `Amount exceeds per-transfer limit of ${config.limits.defaultTransferLimit}`,
      });
      return;
    }

    // Infer alias type if not provided
    let aliasType: AliasType;
    if (body.recipientAliasType) {
      aliasType = body.recipientAliasType as AliasType;
    } else {
      const inferred = inferAliasType(body.recipientAlias);
      if (!inferred) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Could not determine alias type. Please provide recipientAliasType.',
        });
        return;
      }
      aliasType = inferred;
    }

    // Normalize alias
    const normalizedAlias = normalizeAlias(aliasType, body.recipientAlias);

    // Resolve sender account ID from any of the accepted field names
    // Priority: senderAccountId (canonical) > fromAccountId > sourceAccountId
    const senderAccountId = (body.senderAccountId || body.fromAccountId || body.sourceAccountId)!;

    // Determine sender BSIM ID
    // Use senderBsimId from request body if provided (multi-bank support),
    // otherwise fall back to user.bsimId from Bearer token (backward compatibility)
    const senderBsimId = body.senderBsimId || user.bsimId;

    // Validate that senderBsimId matches the authenticated user's context
    // This prevents users from initiating transfers from banks they're not enrolled with
    if (body.senderBsimId && body.senderBsimId !== user.bsimId) {
      // In production, we should verify user has enrollment with this BSIM
      // For now, we trust the orchestrator to only send valid combinations
      // TODO: Add enrollment verification in Phase 6
      console.warn(`[Transfer] User ${user.userId} requesting transfer from different BSIM: ${body.senderBsimId} (auth context: ${user.bsimId})`);
    }

    // Create transfer record
    const transfer = await prisma.transfer.create({
      data: {
        transferId: generateTransferId(),
        senderUserId: user.userId,
        senderBsimId: senderBsimId,
        senderAccountId: senderAccountId,
        recipientAlias: normalizedAlias,
        recipientAliasType: aliasType,
        amount: new Decimal(body.amount),
        currency: body.currency,
        description: body.description,
        status: 'PENDING',
        orchestratorId: orchestrator.orchestratorId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    // Process transfer asynchronously
    processTransfer(transfer.id).catch((err) => {
      console.error('Transfer processing error:', err);
    });

    res.status(201).json({
      transferId: transfer.transferId,
      status: transfer.status,
      amount: transfer.amount.toString(),
      currency: transfer.currency,
      recipientAlias: transfer.recipientAlias,
      createdAt: transfer.createdAt,
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
    console.error('Create transfer error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create transfer',
    });
  }
});

// GET /api/v1/transfers - List transfers
transferRoutes.get('/', requireAuth, requirePermission('canViewTransfers'), async (req: Request, res: Response) => {
  try {
    const query = listTransfersSchema.parse(req.query);
    const user = req.user!;

    // Support both 'type' and 'direction' parameters (direction takes priority for mwsim compat)
    const filterType = query.direction || query.type || 'all';

    const where: Record<string, unknown> = {};

    if (filterType === 'sent') {
      where.senderUserId = user.userId;
      where.senderBsimId = user.bsimId;
    } else if (filterType === 'received') {
      where.recipientUserId = user.userId;
      where.recipientBsimId = user.bsimId;
    } else {
      // 'all' - show both sent and received
      where.OR = [
        { senderUserId: user.userId, senderBsimId: user.bsimId },
        { recipientUserId: user.userId, recipientBsimId: user.bsimId },
      ];
    }

    if (query.status) {
      where.status = query.status.toUpperCase() as TransferStatus;
    }

    const [transfers, total] = await Promise.all([
      prisma.transfer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.transfer.count({ where }),
    ]);

    // Enrich transfers with sender info for received transfers
    const enrichedTransfers = await Promise.all(
      transfers.map(async (t) => {
        const direction = t.senderUserId === user.userId && t.senderBsimId === user.bsimId ? 'sent' : 'received';

        const baseTransfer = {
          transferId: t.transferId,
          status: t.status,
          amount: t.amount.toString(),
          currency: t.currency,
          description: t.description,
          recipientAlias: t.recipientAlias,
          recipientAliasType: t.recipientAliasType,
          direction,
          createdAt: t.createdAt,
          completedAt: t.completedAt,
        };

        // For received transfers, include sender info
        if (direction === 'received') {
          // Get sender's primary alias
          const senderAlias = await prisma.alias.findFirst({
            where: {
              userId: t.senderUserId,
              bsimId: t.senderBsimId,
              isActive: true,
              isPrimary: true,
            },
          });

          // Get sender's bank name
          const senderBank = await prisma.bsimConnection.findUnique({
            where: { bsimId: t.senderBsimId },
          });

          // Get sender's display name from BSIM
          let senderDisplayName: string | undefined;
          const bsimClient = await BsimClient.forBsim(t.senderBsimId);
          if (bsimClient) {
            const verifyResult = await bsimClient.verifyUser({ userId: t.senderUserId });
            if (verifyResult.exists && verifyResult.displayName) {
              senderDisplayName = verifyResult.displayName;
            }
          }

          return {
            ...baseTransfer,
            senderAlias: senderAlias?.value || t.senderAlias,
            senderDisplayName: senderDisplayName || 'Unknown',
            senderBankName: senderBank?.name || 'Unknown Bank',
          };
        }

        return baseTransfer;
      })
    );

    res.json({
      transfers: enrichedTransfers,
      pagination: {
        total,
        limit: query.limit,
        offset: query.offset,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid query parameters',
        details: error.errors,
      });
      return;
    }
    console.error('List transfers error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list transfers',
    });
  }
});

// GET /api/v1/transfers/:transferId - Get transfer status
transferRoutes.get('/:transferId', requireAuth, requirePermission('canViewTransfers'), async (req: Request, res: Response) => {
  try {
    const { transferId } = req.params;
    const user = req.user!;

    const transfer = await prisma.transfer.findFirst({
      where: {
        transferId,
        OR: [
          { senderUserId: user.userId, senderBsimId: user.bsimId },
          { recipientUserId: user.userId, recipientBsimId: user.bsimId },
        ],
      },
    });

    if (!transfer) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Transfer not found',
      });
      return;
    }

    res.json({
      transferId: transfer.transferId,
      status: transfer.status,
      statusMessage: transfer.statusMessage,
      amount: transfer.amount.toString(),
      currency: transfer.currency,
      description: transfer.description,
      recipientAlias: transfer.recipientAlias,
      recipientAliasType: transfer.recipientAliasType,
      direction: transfer.senderUserId === user.userId && transfer.senderBsimId === user.bsimId ? 'sent' : 'received',
      createdAt: transfer.createdAt,
      completedAt: transfer.completedAt,
      expiresAt: transfer.expiresAt,
    });
  } catch (error) {
    console.error('Get transfer error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get transfer',
    });
  }
});

// POST /api/v1/transfers/:transferId/cancel - Cancel pending transfer
transferRoutes.post('/:transferId/cancel', requireAuth, requirePermission('canInitiateTransfers'), async (req: Request, res: Response) => {
  try {
    const { transferId } = req.params;
    const user = req.user!;

    const transfer = await prisma.transfer.findFirst({
      where: {
        transferId,
        senderUserId: user.userId,
        senderBsimId: user.bsimId,
      },
    });

    if (!transfer) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Transfer not found',
      });
      return;
    }

    // Can only cancel pending or recipient_not_found transfers
    const cancellableStatuses: TransferStatus[] = ['PENDING', 'RESOLVING', 'RECIPIENT_NOT_FOUND'];
    if (!cancellableStatuses.includes(transfer.status)) {
      res.status(400).json({
        error: 'Bad Request',
        message: `Cannot cancel transfer in ${transfer.status} status`,
      });
      return;
    }

    await prisma.transfer.update({
      where: { id: transfer.id },
      data: {
        status: 'CANCELLED',
        statusMessage: 'Cancelled by sender',
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Cancel transfer error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to cancel transfer',
    });
  }
});

// Process transfer (async)
async function processTransfer(transferId: string): Promise<void> {
  const transfer = await prisma.transfer.findUnique({
    where: { id: transferId },
  });

  if (!transfer || transfer.status !== 'PENDING') {
    return;
  }

  // Update status to resolving
  await prisma.transfer.update({
    where: { id: transferId },
    data: { status: 'RESOLVING' },
  });

  // Look up recipient alias
  const recipientAlias = await prisma.alias.findFirst({
    where: {
      type: transfer.recipientAliasType,
      normalizedValue: transfer.recipientAlias,
      isActive: true,
      isVerified: true,
    },
  });

  if (!recipientAlias) {
    await prisma.transfer.update({
      where: { id: transferId },
      data: {
        status: 'RECIPIENT_NOT_FOUND',
        statusMessage: 'Recipient alias not found or not verified',
      },
    });
    return;
  }

  // Check if sender is trying to send to themselves
  if (recipientAlias.userId === transfer.senderUserId && recipientAlias.bsimId === transfer.senderBsimId) {
    await prisma.transfer.update({
      where: { id: transferId },
      data: {
        status: 'DEBIT_FAILED',
        statusMessage: 'Cannot transfer to yourself',
      },
    });
    return;
  }

  // Check if recipient is a registered Micro Merchant
  const merchant = await prisma.microMerchant.findUnique({
    where: {
      userId_bsimId: {
        userId: recipientAlias.userId,
        bsimId: recipientAlias.bsimId,
      },
    },
  });

  // Calculate fee if this is a merchant payment
  const isMerchantPayment = merchant && merchant.isActive;
  const feeAmount = isMerchantPayment ? calculateFee(transfer.amount.toNumber()) : null;

  // Update transfer with recipient info and merchant details
  await prisma.transfer.update({
    where: { id: transferId },
    data: {
      recipientUserId: recipientAlias.userId,
      recipientBsimId: recipientAlias.bsimId,
      recipientAccountId: recipientAlias.accountId,
      recipientType: isMerchantPayment ? 'MICRO_MERCHANT' : 'INDIVIDUAL',
      microMerchantId: isMerchantPayment ? merchant.merchantId : null,
      feeAmount: feeAmount ? new Decimal(feeAmount) : null,
      status: 'DEBITING',
    },
  });

  // Execute the transfer via BSIM APIs
  const isSameBank = transfer.senderBsimId === recipientAlias.bsimId;

  if (isSameBank) {
    // Same-bank transfer
    await executeSameBankTransfer(transferId, transfer, recipientAlias);
  } else {
    // Cross-bank transfer
    await executeCrossBankTransfer(transferId, transfer, recipientAlias);
  }
}

// Execute same-bank transfer via BSIM P2P APIs
async function executeSameBankTransfer(
  transferId: string,
  transfer: {
    transferId: string;
    senderUserId: string;
    senderBsimId: string;
    senderAccountId: string;
    recipientAlias: string;
    recipientAliasType: AliasType;
    amount: Decimal;
    currency: string;
    description: string | null;
  },
  recipientAlias: { userId: string; bsimId: string; accountId: string | null }
): Promise<void> {
  // Get BSIM client for this bank
  const bsimClient = await BsimClient.forBsim(transfer.senderBsimId);

  if (!bsimClient) {
    await prisma.transfer.update({
      where: { id: transferId },
      data: {
        status: 'DEBIT_FAILED',
        statusMessage: 'BSIM connection not configured',
      },
    });
    return;
  }

  // Step 1: Debit sender
  // Use internal UUID for BSIM API (not the public p2p_xxx format)
  const debitResult = await bsimClient.debit({
    userId: transfer.senderUserId,
    accountId: transfer.senderAccountId,
    amount: transfer.amount.toNumber(),
    currency: transfer.currency,
    transferId: transferId,
    description: transfer.description || 'P2P Transfer',
  });

  if (!debitResult.success) {
    await prisma.transfer.update({
      where: { id: transferId },
      data: {
        status: 'DEBIT_FAILED',
        statusMessage: debitResult.message || debitResult.error || 'Debit failed',
      },
    });
    console.error(`Transfer ${transfer.transferId} debit failed:`, debitResult.error);
    return;
  }

  // Update with debit transaction ID
  await prisma.transfer.update({
    where: { id: transferId },
    data: {
      debitTransactionId: debitResult.transactionId,
      status: 'CREDITING',
    },
  });

  // Step 2: Credit recipient
  // Use internal UUID for BSIM API (not the public p2p_xxx format)
  const creditResult = await bsimClient.credit({
    userId: recipientAlias.userId,
    accountId: recipientAlias.accountId || undefined,
    amount: transfer.amount.toNumber(),
    currency: transfer.currency,
    transferId: transferId,
    description: transfer.description || 'P2P Transfer',
  });

  if (!creditResult.success) {
    // Credit failed - need to reverse the debit
    // For now, mark as failed (reversal handled in Phase 3)
    await prisma.transfer.update({
      where: { id: transferId },
      data: {
        status: 'CREDIT_FAILED',
        statusMessage: creditResult.message || creditResult.error || 'Credit failed (debit may need reversal)',
      },
    });
    console.error(`Transfer ${transfer.transferId} credit failed:`, creditResult.error);
    return;
  }

  // Transfer complete
  const completedTransfer = await prisma.transfer.update({
    where: { id: transferId },
    data: {
      status: 'COMPLETED',
      statusMessage: 'Transfer completed successfully',
      completedAt: new Date(),
      creditTransactionId: creditResult.transactionId,
    },
  });

  console.log(`Transfer ${transfer.transferId} completed: ${transfer.amount} ${transfer.currency} from ${transfer.senderUserId} to ${recipientAlias.userId}`);

  // Update merchant stats if this was a merchant payment
  await updateMerchantStatsIfApplicable(completedTransfer);

  // Send push notification webhook to WSIM (fire-and-forget)
  await sendTransferCompletedNotification({
    transferId: transfer.transferId,
    senderUserId: transfer.senderUserId,
    senderBsimId: transfer.senderBsimId,
    recipientUserId: recipientAlias.userId,
    recipientBsimId: recipientAlias.bsimId,
    recipientAlias: transfer.recipientAlias,
    recipientAliasType: transfer.recipientAliasType,
    amount: transfer.amount.toString(),
    currency: transfer.currency,
    description: transfer.description,
    isCrossBank: false,
  });
}

// Helper to update merchant stats after completed transfer
async function updateMerchantStatsIfApplicable(transfer: {
  recipientType: string;
  microMerchantId: string | null;
  recipientUserId: string | null;
  recipientBsimId: string | null;
  amount: Decimal;
  feeAmount: Decimal | null;
}): Promise<void> {
  if (transfer.recipientType !== 'MICRO_MERCHANT' || !transfer.recipientUserId || !transfer.recipientBsimId) {
    return;
  }

  try {
    await prisma.microMerchant.update({
      where: {
        userId_bsimId: {
          userId: transfer.recipientUserId,
          bsimId: transfer.recipientBsimId,
        },
      },
      data: {
        totalReceived: { increment: transfer.amount },
        totalTransactions: { increment: 1 },
        totalFees: { increment: transfer.feeAmount || new Decimal(0) },
      },
    });
    console.log(`[Merchant] Updated stats for merchant receiving ${transfer.amount}`);
  } catch (error) {
    // Log but don't fail - stats update is secondary to transfer completion
    console.error('[Merchant] Failed to update merchant stats:', error);
  }
}

// Execute cross-bank transfer via BSIM P2P APIs
async function executeCrossBankTransfer(
  transferId: string,
  transfer: {
    transferId: string;
    senderUserId: string;
    senderBsimId: string;
    senderAccountId: string;
    recipientAlias: string;
    recipientAliasType: AliasType;
    amount: Decimal;
    currency: string;
    description: string | null;
  },
  recipientAlias: { userId: string; bsimId: string; accountId: string | null }
): Promise<void> {
  // Get BSIM clients for both banks
  const senderBsimClient = await BsimClient.forBsim(transfer.senderBsimId);
  const recipientBsimClient = await BsimClient.forBsim(recipientAlias.bsimId);

  if (!senderBsimClient) {
    await prisma.transfer.update({
      where: { id: transferId },
      data: {
        status: 'DEBIT_FAILED',
        statusMessage: 'Sender BSIM connection not configured',
      },
    });
    return;
  }

  if (!recipientBsimClient) {
    await prisma.transfer.update({
      where: { id: transferId },
      data: {
        status: 'CREDIT_FAILED',
        statusMessage: 'Recipient BSIM connection not configured',
      },
    });
    return;
  }

  // Step 1: Debit sender at sender's bank
  // Use internal UUID for BSIM API (not the public p2p_xxx format)
  const debitResult = await senderBsimClient.debit({
    userId: transfer.senderUserId,
    accountId: transfer.senderAccountId,
    amount: transfer.amount.toNumber(),
    currency: transfer.currency,
    transferId: transferId,
    description: transfer.description || 'P2P Transfer (Cross-bank)',
  });

  if (!debitResult.success) {
    await prisma.transfer.update({
      where: { id: transferId },
      data: {
        status: 'DEBIT_FAILED',
        statusMessage: debitResult.message || debitResult.error || 'Debit failed',
      },
    });
    console.error(`Cross-bank transfer ${transfer.transferId} debit failed:`, debitResult.error);
    return;
  }

  // Update with debit transaction ID
  await prisma.transfer.update({
    where: { id: transferId },
    data: {
      debitTransactionId: debitResult.transactionId,
      status: 'CREDITING',
    },
  });

  // Step 2: Credit recipient at recipient's bank
  // Use internal UUID for BSIM API (not the public p2p_xxx format)
  const creditResult = await recipientBsimClient.credit({
    userId: recipientAlias.userId,
    accountId: recipientAlias.accountId || undefined,
    amount: transfer.amount.toNumber(),
    currency: transfer.currency,
    transferId: transferId,
    description: transfer.description || 'P2P Transfer (Cross-bank)',
  });

  if (!creditResult.success) {
    // Credit failed - debit already done, needs reversal
    await prisma.transfer.update({
      where: { id: transferId },
      data: {
        status: 'CREDIT_FAILED',
        statusMessage: creditResult.message || creditResult.error || 'Credit failed at recipient bank (debit may need reversal)',
      },
    });
    console.error(`Cross-bank transfer ${transfer.transferId} credit failed:`, creditResult.error);
    // TODO: Implement automatic reversal in Phase 3
    return;
  }

  // Transfer complete
  const completedTransfer = await prisma.transfer.update({
    where: { id: transferId },
    data: {
      status: 'COMPLETED',
      statusMessage: 'Cross-bank transfer completed successfully',
      completedAt: new Date(),
      creditTransactionId: creditResult.transactionId,
    },
  });

  console.log(`Cross-bank transfer ${transfer.transferId} completed: ${transfer.amount} ${transfer.currency} from ${transfer.senderBsimId}:${transfer.senderUserId} to ${recipientAlias.bsimId}:${recipientAlias.userId}`);

  // Update merchant stats if this was a merchant payment
  await updateMerchantStatsIfApplicable(completedTransfer);

  // Send push notification webhook to WSIM (fire-and-forget)
  await sendTransferCompletedNotification({
    transferId: transfer.transferId,
    senderUserId: transfer.senderUserId,
    senderBsimId: transfer.senderBsimId,
    recipientUserId: recipientAlias.userId,
    recipientBsimId: recipientAlias.bsimId,
    recipientAlias: transfer.recipientAlias,
    recipientAliasType: transfer.recipientAliasType,
    amount: transfer.amount.toString(),
    currency: transfer.currency,
    description: transfer.description,
    isCrossBank: true,
  });
}

// Helper to infer alias type from value
function inferAliasType(value: string): AliasType | undefined {
  if (value.includes('@') && value.includes('.')) {
    return 'EMAIL';
  }
  if (value.startsWith('@')) {
    return 'USERNAME';
  }
  if (/^\+?\d{10,15}$/.test(value.replace(/\D/g, ''))) {
    return 'PHONE';
  }
  if (/^[A-Z0-9]{8}$/i.test(value)) {
    return 'RANDOM_KEY';
  }
  return undefined;
}

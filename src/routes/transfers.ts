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

export const transferRoutes = Router();

// Validation schemas
const createTransferSchema = z.object({
  recipientAlias: z.string().min(1),
  recipientAliasType: z.enum(['EMAIL', 'PHONE', 'USERNAME', 'RANDOM_KEY']).optional(),
  amount: z.number().positive(),
  currency: z.string().default('CAD'),
  description: z.string().max(200).optional(),
  fromAccountId: z.string(),
});

const listTransfersSchema = z.object({
  type: z.enum(['sent', 'received', 'all']).optional().default('all'),
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

    // Create transfer record
    const transfer = await prisma.transfer.create({
      data: {
        transferId: generateTransferId(),
        senderUserId: user.userId,
        senderBsimId: user.bsimId,
        senderAccountId: body.fromAccountId,
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

    const where: Record<string, unknown> = {};

    if (query.type === 'sent') {
      where.senderUserId = user.userId;
      where.senderBsimId = user.bsimId;
    } else if (query.type === 'received') {
      where.recipientUserId = user.userId;
      where.recipientBsimId = user.bsimId;
    } else {
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

    res.json({
      transfers: transfers.map((t) => ({
        transferId: t.transferId,
        status: t.status,
        amount: t.amount.toString(),
        currency: t.currency,
        description: t.description,
        recipientAlias: t.recipientAlias,
        recipientAliasType: t.recipientAliasType,
        direction: t.senderUserId === user.userId && t.senderBsimId === user.bsimId ? 'sent' : 'received',
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      })),
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

  // Update transfer with recipient info
  await prisma.transfer.update({
    where: { id: transferId },
    data: {
      recipientUserId: recipientAlias.userId,
      recipientBsimId: recipientAlias.bsimId,
      recipientAccountId: recipientAlias.accountId,
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
  await prisma.transfer.update({
    where: { id: transferId },
    data: {
      status: 'COMPLETED',
      statusMessage: 'Transfer completed successfully',
      completedAt: new Date(),
      creditTransactionId: creditResult.transactionId,
    },
  });

  console.log(`Transfer ${transfer.transferId} completed: ${transfer.amount} ${transfer.currency} from ${transfer.senderUserId} to ${recipientAlias.userId}`);
}

// Execute cross-bank transfer via BSIM P2P APIs
async function executeCrossBankTransfer(
  transferId: string,
  transfer: {
    transferId: string;
    senderUserId: string;
    senderBsimId: string;
    senderAccountId: string;
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
  await prisma.transfer.update({
    where: { id: transferId },
    data: {
      status: 'COMPLETED',
      statusMessage: 'Cross-bank transfer completed successfully',
      completedAt: new Date(),
      creditTransactionId: creditResult.transactionId,
    },
  });

  console.log(`Cross-bank transfer ${transfer.transferId} completed: ${transfer.amount} ${transfer.currency} from ${transfer.senderBsimId}:${transfer.senderUserId} to ${recipientAlias.bsimId}:${recipientAlias.userId}`);
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

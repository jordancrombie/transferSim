import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { generateMerchantId } from '../utils/id.js';
import { MerchantCategory } from '@prisma/client';

export const microMerchantRoutes = Router();

// Validation schemas
const createMerchantSchema = z.object({
  merchantName: z.string().min(2).max(100),
  merchantCategory: z.nativeEnum(MerchantCategory).optional().default('OTHER'),
  description: z.string().max(500).optional(),
  receivingAliasId: z.string().optional(),
  receivingAccountId: z.string().optional(),
});

const updateMerchantSchema = z.object({
  merchantName: z.string().min(2).max(100).optional(),
  merchantCategory: z.nativeEnum(MerchantCategory).optional(),
  description: z.string().max(500).optional().nullable(),
  receivingAliasId: z.string().optional().nullable(),
  receivingAccountId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

// Fee calculation based on tiered flat fee structure
// < $200: $0.25, >= $200: $0.50
export function calculateFee(amount: number): number {
  return amount < 200 ? 0.25 : 0.50;
}

// POST /api/v1/micro-merchants - Register as a Micro Merchant
microMerchantRoutes.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = createMerchantSchema.parse(req.body);
    const user = req.user!;

    // Check if user is already a Micro Merchant
    const existingMerchant = await prisma.microMerchant.findUnique({
      where: {
        userId_bsimId: {
          userId: user.userId,
          bsimId: user.bsimId,
        },
      },
    });

    if (existingMerchant) {
      res.status(409).json({
        error: 'Conflict',
        message: 'User is already registered as a Micro Merchant',
        merchantId: existingMerchant.merchantId,
      });
      return;
    }

    // If receivingAliasId provided, verify it belongs to user
    if (body.receivingAliasId) {
      const alias = await prisma.alias.findFirst({
        where: {
          id: body.receivingAliasId,
          userId: user.userId,
          bsimId: user.bsimId,
          isActive: true,
        },
      });

      if (!alias) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Receiving alias not found or does not belong to user',
        });
        return;
      }
    }

    const merchant = await prisma.microMerchant.create({
      data: {
        merchantId: generateMerchantId(),
        userId: user.userId,
        bsimId: user.bsimId,
        merchantName: body.merchantName,
        merchantCategory: body.merchantCategory,
        description: body.description,
        receivingAliasId: body.receivingAliasId,
        receivingAccountId: body.receivingAccountId,
      },
    });

    res.status(201).json({
      merchantId: merchant.merchantId,
      merchantName: merchant.merchantName,
      merchantCategory: merchant.merchantCategory,
      description: merchant.description,
      receivingAliasId: merchant.receivingAliasId,
      receivingAccountId: merchant.receivingAccountId,
      isActive: merchant.isActive,
      createdAt: merchant.createdAt,
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
    console.error('Create micro merchant error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create micro merchant',
    });
  }
});

// GET /api/v1/micro-merchants/me - Get current user's Micro Merchant profile
microMerchantRoutes.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const merchant = await prisma.microMerchant.findUnique({
      where: {
        userId_bsimId: {
          userId: user.userId,
          bsimId: user.bsimId,
        },
      },
    });

    if (!merchant) {
      res.status(404).json({
        error: 'Not Found',
        message: 'User is not registered as a Micro Merchant',
      });
      return;
    }

    res.json({
      merchantId: merchant.merchantId,
      merchantName: merchant.merchantName,
      merchantCategory: merchant.merchantCategory,
      description: merchant.description,
      receivingAliasId: merchant.receivingAliasId,
      receivingAccountId: merchant.receivingAccountId,
      isActive: merchant.isActive,
      stats: {
        totalReceived: merchant.totalReceived.toString(),
        totalTransactions: merchant.totalTransactions,
        totalFees: merchant.totalFees.toString(),
      },
      createdAt: merchant.createdAt,
      updatedAt: merchant.updatedAt,
    });
  } catch (error) {
    console.error('Get micro merchant profile error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get micro merchant profile',
    });
  }
});

// PUT /api/v1/micro-merchants/me - Update current user's Micro Merchant profile
microMerchantRoutes.put('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = updateMerchantSchema.parse(req.body);
    const user = req.user!;

    const existingMerchant = await prisma.microMerchant.findUnique({
      where: {
        userId_bsimId: {
          userId: user.userId,
          bsimId: user.bsimId,
        },
      },
    });

    if (!existingMerchant) {
      res.status(404).json({
        error: 'Not Found',
        message: 'User is not registered as a Micro Merchant',
      });
      return;
    }

    // If receivingAliasId is being updated, verify it belongs to user
    if (body.receivingAliasId) {
      const alias = await prisma.alias.findFirst({
        where: {
          id: body.receivingAliasId,
          userId: user.userId,
          bsimId: user.bsimId,
          isActive: true,
        },
      });

      if (!alias) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Receiving alias not found or does not belong to user',
        });
        return;
      }
    }

    const merchant = await prisma.microMerchant.update({
      where: {
        userId_bsimId: {
          userId: user.userId,
          bsimId: user.bsimId,
        },
      },
      data: {
        ...(body.merchantName && { merchantName: body.merchantName }),
        ...(body.merchantCategory && { merchantCategory: body.merchantCategory }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.receivingAliasId !== undefined && { receivingAliasId: body.receivingAliasId }),
        ...(body.receivingAccountId !== undefined && { receivingAccountId: body.receivingAccountId }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });

    res.json({
      merchantId: merchant.merchantId,
      merchantName: merchant.merchantName,
      merchantCategory: merchant.merchantCategory,
      description: merchant.description,
      receivingAliasId: merchant.receivingAliasId,
      receivingAccountId: merchant.receivingAccountId,
      isActive: merchant.isActive,
      updatedAt: merchant.updatedAt,
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
    console.error('Update micro merchant error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update micro merchant profile',
    });
  }
});

// GET /api/v1/micro-merchants/me/dashboard - Get dashboard metrics
microMerchantRoutes.get('/me/dashboard', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const merchant = await prisma.microMerchant.findUnique({
      where: {
        userId_bsimId: {
          userId: user.userId,
          bsimId: user.bsimId,
        },
      },
    });

    if (!merchant) {
      res.status(404).json({
        error: 'Not Found',
        message: 'User is not registered as a Micro Merchant',
      });
      return;
    }

    // Get recent transactions (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentTransactions = await prisma.transfer.findMany({
      where: {
        recipientUserId: user.userId,
        recipientBsimId: user.bsimId,
        recipientType: 'MICRO_MERCHANT',
        status: 'COMPLETED',
        completedAt: {
          gte: thirtyDaysAgo,
        },
      },
      orderBy: { completedAt: 'desc' },
      take: 10,
    });

    // Calculate 30-day metrics
    const thirtyDayStats = await prisma.transfer.aggregate({
      where: {
        recipientUserId: user.userId,
        recipientBsimId: user.bsimId,
        recipientType: 'MICRO_MERCHANT',
        status: 'COMPLETED',
        completedAt: {
          gte: thirtyDaysAgo,
        },
      },
      _sum: {
        amount: true,
        feeAmount: true,
      },
      _count: true,
    });

    // Calculate 7-day metrics
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const sevenDayStats = await prisma.transfer.aggregate({
      where: {
        recipientUserId: user.userId,
        recipientBsimId: user.bsimId,
        recipientType: 'MICRO_MERCHANT',
        status: 'COMPLETED',
        completedAt: {
          gte: sevenDaysAgo,
        },
      },
      _sum: {
        amount: true,
        feeAmount: true,
      },
      _count: true,
    });

    // Calculate today's metrics (UTC start of day)
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const todayStats = await prisma.transfer.aggregate({
      where: {
        recipientUserId: user.userId,
        recipientBsimId: user.bsimId,
        recipientType: 'MICRO_MERCHANT',
        status: 'COMPLETED',
        completedAt: {
          gte: todayStart,
        },
      },
      _sum: {
        amount: true,
        feeAmount: true,
      },
      _count: true,
    });

    res.json({
      merchantId: merchant.merchantId,
      merchantName: merchant.merchantName,
      allTime: {
        totalReceived: merchant.totalReceived.toString(),
        totalTransactions: merchant.totalTransactions,
        totalFees: merchant.totalFees.toString(),
      },
      today: {
        totalReceived: todayStats._sum.amount?.toString() || '0',
        totalTransactions: todayStats._count,
        totalFees: todayStats._sum.feeAmount?.toString() || '0',
      },
      last7Days: {
        totalReceived: sevenDayStats._sum.amount?.toString() || '0',
        totalTransactions: sevenDayStats._count,
        totalFees: sevenDayStats._sum.feeAmount?.toString() || '0',
      },
      last30Days: {
        totalReceived: thirtyDayStats._sum.amount?.toString() || '0',
        totalTransactions: thirtyDayStats._count,
        totalFees: thirtyDayStats._sum.feeAmount?.toString() || '0',
      },
      recentTransactions: recentTransactions.map(t => ({
        transferId: t.transferId,
        amount: t.amount.toString(),
        feeAmount: t.feeAmount?.toString() || '0',
        currency: t.currency,
        description: t.description,
        completedAt: t.completedAt,
      })),
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get dashboard metrics',
    });
  }
});

// GET /api/v1/micro-merchants/me/transactions - Get business transaction history
microMerchantRoutes.get('/me/transactions', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const merchant = await prisma.microMerchant.findUnique({
      where: {
        userId_bsimId: {
          userId: user.userId,
          bsimId: user.bsimId,
        },
      },
    });

    if (!merchant) {
      res.status(404).json({
        error: 'Not Found',
        message: 'User is not registered as a Micro Merchant',
      });
      return;
    }

    const [transactions, total] = await Promise.all([
      prisma.transfer.findMany({
        where: {
          recipientUserId: user.userId,
          recipientBsimId: user.bsimId,
          recipientType: 'MICRO_MERCHANT',
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.transfer.count({
        where: {
          recipientUserId: user.userId,
          recipientBsimId: user.bsimId,
          recipientType: 'MICRO_MERCHANT',
        },
      }),
    ]);

    res.json({
      transactions: transactions.map(t => ({
        transferId: t.transferId,
        amount: t.amount.toString(),
        feeAmount: t.feeAmount?.toString() || '0',
        netAmount: t.feeAmount
          ? new Decimal(t.amount).minus(t.feeAmount).toString()
          : t.amount.toString(),
        currency: t.currency,
        description: t.description,
        status: t.status,
        senderAlias: t.senderAlias,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + transactions.length < total,
      },
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get transaction history',
    });
  }
});

// GET /api/v1/micro-merchants/:merchantId - Public merchant lookup (for QR code scanning)
microMerchantRoutes.get('/:merchantId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { merchantId } = req.params;

    const merchant = await prisma.microMerchant.findUnique({
      where: { merchantId },
    });

    if (!merchant || !merchant.isActive) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Merchant not found',
      });
      return;
    }

    // Return public merchant info for payment confirmation
    res.json({
      merchantId: merchant.merchantId,
      merchantName: merchant.merchantName,
      merchantCategory: merchant.merchantCategory,
      recipientType: 'MICRO_MERCHANT',
    });
  } catch (error) {
    console.error('Get merchant error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get merchant',
    });
  }
});

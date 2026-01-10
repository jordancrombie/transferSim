import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';
import multer from 'multer';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { generateMerchantId } from '../utils/id.js';
import { MerchantCategory } from '@prisma/client';
import {
  validateImage,
  uploadMerchantLogo,
  deleteFromS3,
  generateInitialsColor,
} from '../services/imageService.js';

export const microMerchantRoutes = Router();

// Multer configuration for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
  },
});

// Simple in-memory rate limiting for logo uploads
// Rate limit: 5 uploads per merchant per hour
const logoUploadRateLimit = new Map<string, { count: number; resetAt: number }>();
const LOGO_UPLOAD_LIMIT = 5;
const LOGO_UPLOAD_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkLogoUploadRateLimit(merchantId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = logoUploadRateLimit.get(merchantId);

  if (!record || now >= record.resetAt) {
    // Reset or create new record
    logoUploadRateLimit.set(merchantId, { count: 1, resetAt: now + LOGO_UPLOAD_WINDOW_MS });
    return { allowed: true };
  }

  if (record.count >= LOGO_UPLOAD_LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((record.resetAt - now) / 1000) };
  }

  record.count++;
  return { allowed: true };
}

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
      logoImageUrl: merchant.logoImageUrl,
      initialsColor: merchant.initialsColor || generateInitialsColor(merchant.merchantId),
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

    // Calculate today's metrics using client timezone
    // Accept timezone offset in minutes from JavaScript's getTimezoneOffset()
    // getTimezoneOffset() returns positive for west of UTC (e.g., 300 for Eastern = UTC-5)
    const tzOffset = parseInt(req.query.tzOffset as string) || 0;

    // Calculate start of day in client's local timezone
    const now = new Date();

    // Step 1: Convert UTC to local time by SUBTRACTING offset (since offset is positive for west)
    const localTime = new Date(now.getTime() - tzOffset * 60 * 1000);

    // Step 2: Set to start of day (midnight) in this local representation
    localTime.setUTCHours(0, 0, 0, 0);

    // Step 3: Convert back to UTC by ADDING offset
    const todayStart = new Date(localTime.getTime() + tzOffset * 60 * 1000);

    console.log(`[Dashboard] tzOffset=${tzOffset}, todayStart=${todayStart.toISOString()}, now=${now.toISOString()}`);

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

    // Get unique sender bank IDs to look up bank names for recent transactions
    const senderBsimIds = [...new Set(recentTransactions.map(t => t.senderBsimId))];
    const bsimConnections = await prisma.bsimConnection.findMany({
      where: { bsimId: { in: senderBsimIds } },
      select: { bsimId: true, name: true },
    });
    const bankNameMap = new Map(bsimConnections.map(b => [b.bsimId, b.name]));

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
        senderAlias: t.senderAlias,
        senderBsimId: t.senderBsimId,
        senderBankName: bankNameMap.get(t.senderBsimId) || null,
        senderAccountLast4: t.senderAccountId ? t.senderAccountId.slice(-4) : null,
        senderProfileImageUrl: t.senderProfileImageUrl,
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

    // Get unique sender bank IDs to look up bank names
    const senderBsimIds = [...new Set(transactions.map(t => t.senderBsimId))];
    const bsimConnections = await prisma.bsimConnection.findMany({
      where: { bsimId: { in: senderBsimIds } },
      select: { bsimId: true, name: true },
    });
    const bankNameMap = new Map(bsimConnections.map(b => [b.bsimId, b.name]));

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
        senderBsimId: t.senderBsimId,
        senderBankName: bankNameMap.get(t.senderBsimId) || null,
        senderAccountLast4: t.senderAccountId ? t.senderAccountId.slice(-4) : null,
        senderProfileImageUrl: t.senderProfileImageUrl,
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

// POST /api/v1/micro-merchants/me/profile/logo - Upload merchant logo
microMerchantRoutes.post(
  '/me/profile/logo',
  requireAuth,
  upload.single('logo'),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;

      // Find merchant
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

      // Check rate limit
      const rateLimit = checkLogoUploadRateLimit(merchant.merchantId);
      if (!rateLimit.allowed) {
        res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`,
          retryAfter: rateLimit.retryAfter,
        });
        return;
      }

      // Check if file was provided
      if (!req.file) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'No image file provided. Use field name "logo".',
        });
        return;
      }

      // Validate image
      const validation = validateImage(req.file.buffer, req.file.mimetype);
      if (!validation.valid) {
        res.status(400).json({
          error: 'Bad Request',
          message: validation.error,
        });
        return;
      }

      console.log(`[Logo] Uploading logo for merchant ${merchant.merchantId}, size=${req.file.size}`);

      // Upload to S3 and get URLs
      const uploadResult = await uploadMerchantLogo(
        merchant.merchantId,
        req.file.buffer,
        req.file.mimetype
      );

      // Generate initials color (for fallback when logo fails to load)
      const initialsColor = generateInitialsColor(merchant.merchantId);

      // Update merchant record
      await prisma.microMerchant.update({
        where: { merchantId: merchant.merchantId },
        data: {
          logoImageUrl: uploadResult.logoImageUrl,
          logoImageKey: uploadResult.logoImageKey,
          initialsColor: initialsColor,
        },
      });

      console.log(`[Logo] Successfully uploaded logo for merchant ${merchant.merchantId}`);

      res.json({
        logoImageUrl: uploadResult.logoImageUrl,
        logoImageKey: uploadResult.logoImageKey,
        initialsColor: initialsColor,
        thumbnails: uploadResult.thumbnails,
      });
    } catch (error) {
      console.error('Upload logo error:', error);
      // Check for multer errors
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({
            error: 'Bad Request',
            message: 'File size exceeds 5MB limit',
          });
          return;
        }
      }
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to upload logo',
      });
    }
  }
);

// DELETE /api/v1/micro-merchants/me/profile/logo - Delete merchant logo
microMerchantRoutes.delete('/me/profile/logo', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    // Find merchant
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

    // Check if merchant has a logo
    if (!merchant.logoImageKey) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Merchant does not have a logo to delete',
      });
      return;
    }

    console.log(`[Logo] Deleting logo for merchant ${merchant.merchantId}`);

    // Delete from S3
    await deleteFromS3(merchant.merchantId);

    // Clear logo fields in database (keep initialsColor for fallback)
    await prisma.microMerchant.update({
      where: { merchantId: merchant.merchantId },
      data: {
        logoImageUrl: null,
        logoImageKey: null,
      },
    });

    console.log(`[Logo] Successfully deleted logo for merchant ${merchant.merchantId}`);

    res.json({
      success: true,
      message: 'Logo deleted successfully',
      initialsColor: merchant.initialsColor, // Return for UI fallback
    });
  } catch (error) {
    console.error('Delete logo error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete logo',
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
      logoImageUrl: merchant.logoImageUrl,
      initialsColor: merchant.initialsColor || generateInitialsColor(merchant.merchantId),
    });
  } catch (error) {
    console.error('Get merchant error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get merchant',
    });
  }
});

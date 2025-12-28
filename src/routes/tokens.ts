import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { generateTokenId } from '../utils/id.js';
import { config } from '../config/index.js';

export const tokenRoutes = Router();

// Validation schemas
const createReceiveTokenSchema = z.object({
  aliasId: z.string().optional(),
  amount: z.number().positive().optional(),
  currency: z.string().default('CAD'),
  description: z.string().max(200).optional(),
});

const createSendTokenSchema = z.object({
  recipientAlias: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().default('CAD'),
  description: z.string().max(200).optional(),
  fromAccountId: z.string(),
});

// POST /api/v1/tokens/receive - Generate receive token (for QR code)
tokenRoutes.post('/receive', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = createReceiveTokenSchema.parse(req.body);
    const user = req.user!;

    // If aliasId provided, verify it belongs to user
    if (body.aliasId) {
      const alias = await prisma.alias.findFirst({
        where: {
          id: body.aliasId,
          userId: user.userId,
          bsimId: user.bsimId,
          isActive: true,
        },
      });

      if (!alias) {
        res.status(404).json({
          error: 'Not Found',
          message: 'Alias not found',
        });
        return;
      }
    }

    const expiresAt = new Date(Date.now() + config.tokenExpirySeconds * 1000);

    const token = await prisma.token.create({
      data: {
        tokenId: generateTokenId(),
        type: 'RECEIVE',
        aliasId: body.aliasId,
        userId: user.userId,
        bsimId: user.bsimId,
        amount: body.amount ? new Decimal(body.amount) : null,
        currency: body.currency,
        description: body.description,
        expiresAt,
      },
    });

    res.status(201).json({
      tokenId: token.tokenId,
      type: token.type,
      amount: token.amount?.toString(),
      currency: token.currency,
      description: token.description,
      expiresAt: token.expiresAt,
      // QR payload that can be encoded
      qrPayload: JSON.stringify({
        t: token.tokenId,
        a: token.amount?.toString(),
        c: token.currency,
      }),
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
    console.error('Create receive token error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create token',
    });
  }
});

// POST /api/v1/tokens/send - Generate pre-authorized send token
tokenRoutes.post('/send', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = createSendTokenSchema.parse(req.body);
    const user = req.user!;

    // Validate amount against limits
    if (body.amount > config.limits.defaultTransferLimit) {
      res.status(400).json({
        error: 'Bad Request',
        message: `Amount exceeds per-transfer limit of ${config.limits.defaultTransferLimit}`,
      });
      return;
    }

    const expiresAt = new Date(Date.now() + config.tokenExpirySeconds * 1000);

    const token = await prisma.token.create({
      data: {
        tokenId: generateTokenId(),
        type: 'SEND',
        userId: user.userId,
        bsimId: user.bsimId,
        amount: new Decimal(body.amount),
        currency: body.currency,
        description: body.description,
        expiresAt,
      },
    });

    res.status(201).json({
      tokenId: token.tokenId,
      type: token.type,
      amount: token.amount?.toString(),
      currency: token.currency,
      description: token.description,
      expiresAt: token.expiresAt,
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
    console.error('Create send token error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create token',
    });
  }
});

// GET /api/v1/tokens/:tokenId - Resolve token
tokenRoutes.get('/:tokenId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;

    const token = await prisma.token.findUnique({
      where: { tokenId },
    });

    if (!token) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Token not found',
      });
      return;
    }

    // Check if expired
    if (token.expiresAt < new Date()) {
      res.status(410).json({
        error: 'Gone',
        message: 'Token has expired',
      });
      return;
    }

    // Check if already used
    if (token.isUsed) {
      res.status(410).json({
        error: 'Gone',
        message: 'Token has already been used',
      });
      return;
    }

    // Get alias info if available
    let aliasInfo = null;
    if (token.aliasId) {
      const alias = await prisma.alias.findUnique({
        where: { id: token.aliasId },
      });
      if (alias) {
        aliasInfo = {
          type: alias.type,
          value: alias.value,
        };
      }
    }

    res.json({
      tokenId: token.tokenId,
      type: token.type,
      amount: token.amount?.toString(),
      currency: token.currency,
      description: token.description,
      alias: aliasInfo,
      expiresAt: token.expiresAt,
    });
  } catch (error) {
    console.error('Resolve token error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to resolve token',
    });
  }
});

// POST /api/v1/tokens/:tokenId/use - Mark token as used (called after transfer)
tokenRoutes.post('/:tokenId/use', requireAuth, async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const user = req.user!;

    const token = await prisma.token.findUnique({
      where: { tokenId },
    });

    if (!token) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Token not found',
      });
      return;
    }

    if (token.isUsed) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Token already used',
      });
      return;
    }

    if (token.expiresAt < new Date()) {
      res.status(410).json({
        error: 'Gone',
        message: 'Token has expired',
      });
      return;
    }

    await prisma.token.update({
      where: { tokenId },
      data: {
        isUsed: true,
        usedAt: new Date(),
        usedByUserId: user.userId,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Use token error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to use token',
    });
  }
});

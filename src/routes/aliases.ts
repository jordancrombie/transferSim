import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { normalizeAlias, validateAliasFormat } from '../utils/normalize.js';
import { generateRandomKey } from '../utils/id.js';
import { AliasType } from '@prisma/client';

export const aliasRoutes = Router();

// Validation schemas
const createAliasSchema = z.object({
  type: z.enum(['EMAIL', 'PHONE', 'USERNAME', 'RANDOM_KEY']),
  value: z.string().optional(), // Required for all except RANDOM_KEY
  accountId: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

const lookupAliasSchema = z.object({
  alias: z.string().min(1),
  type: z.enum(['EMAIL', 'PHONE', 'USERNAME', 'RANDOM_KEY']).optional(),
});

// POST /api/v1/aliases - Register new alias
aliasRoutes.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = createAliasSchema.parse(req.body);
    const user = req.user!;

    let value: string;
    let type: AliasType = body.type as AliasType;

    // Generate random key if type is RANDOM_KEY
    if (type === 'RANDOM_KEY') {
      value = generateRandomKey();
    } else if (!body.value) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Value is required for non-RANDOM_KEY alias types',
      });
      return;
    } else {
      value = body.value;
    }

    // Validate format
    const validation = validateAliasFormat(type, value);
    if (!validation.valid) {
      res.status(400).json({
        error: 'Bad Request',
        message: validation.error,
      });
      return;
    }

    // Normalize the value
    const normalizedValue = normalizeAlias(type, value);

    // Check if alias already exists
    const existing = await prisma.alias.findUnique({
      where: {
        type_normalizedValue: {
          type,
          normalizedValue,
        },
      },
    });

    if (existing) {
      res.status(409).json({
        error: 'Conflict',
        message: 'This alias is already registered',
      });
      return;
    }

    // If setting as primary, unset other primary aliases for this user
    if (body.isPrimary) {
      await prisma.alias.updateMany({
        where: {
          userId: user.userId,
          bsimId: user.bsimId,
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
    }

    // Create the alias
    const alias = await prisma.alias.create({
      data: {
        type,
        value,
        normalizedValue,
        userId: user.userId,
        bsimId: user.bsimId,
        accountId: body.accountId,
        isPrimary: body.isPrimary || false,
        // RANDOM_KEY and USERNAME are verified immediately
        isVerified: type === 'RANDOM_KEY' || type === 'USERNAME',
        verifiedAt: type === 'RANDOM_KEY' || type === 'USERNAME' ? new Date() : null,
      },
    });

    res.status(201).json({
      id: alias.id,
      type: alias.type,
      value: alias.value,
      isVerified: alias.isVerified,
      isPrimary: alias.isPrimary,
      createdAt: alias.createdAt,
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
    console.error('Create alias error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create alias',
    });
  }
});

// GET /api/v1/aliases - List user's aliases
aliasRoutes.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const aliases = await prisma.alias.findMany({
      where: {
        userId: user.userId,
        bsimId: user.bsimId,
        isActive: true,
      },
      orderBy: [
        { isPrimary: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    res.json({
      aliases: aliases.map((alias) => ({
        id: alias.id,
        type: alias.type,
        value: alias.value,
        isVerified: alias.isVerified,
        isPrimary: alias.isPrimary,
        accountId: alias.accountId,
        createdAt: alias.createdAt,
      })),
    });
  } catch (error) {
    console.error('List aliases error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list aliases',
    });
  }
});

// GET /api/v1/aliases/lookup - Look up alias (returns partial info for privacy)
aliasRoutes.get('/lookup', requireAuth, async (req: Request, res: Response) => {
  try {
    const query = lookupAliasSchema.parse(req.query);

    // Determine alias type if not provided
    let aliasType: AliasType | undefined;
    if (query.type) {
      aliasType = query.type as AliasType;
    } else {
      aliasType = inferAliasType(query.alias);
    }

    if (!aliasType) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Could not determine alias type. Please provide type parameter.',
      });
      return;
    }

    const normalizedValue = normalizeAlias(aliasType, query.alias);

    const alias = await prisma.alias.findFirst({
      where: {
        type: aliasType,
        normalizedValue,
        isActive: true,
        isVerified: true,
      },
    });

    if (!alias) {
      res.json({ found: false });
      return;
    }

    // Get bank name from BSIM connection
    const bsimConnection = await prisma.bsimConnection.findUnique({
      where: { bsimId: alias.bsimId },
    });

    res.json({
      found: true,
      aliasType: alias.type,
      bankName: bsimConnection?.name || 'Unknown Bank',
      // Don't expose userId, accountId, or full details
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
    console.error('Lookup alias error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to lookup alias',
    });
  }
});

// DELETE /api/v1/aliases/:aliasId - Remove alias
aliasRoutes.delete('/:aliasId', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { aliasId } = req.params;

    const alias = await prisma.alias.findFirst({
      where: {
        id: aliasId,
        userId: user.userId,
        bsimId: user.bsimId,
      },
    });

    if (!alias) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Alias not found',
      });
      return;
    }

    // Soft delete
    await prisma.alias.update({
      where: { id: aliasId },
      data: { isActive: false },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete alias error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete alias',
    });
  }
});

// POST /api/v1/aliases/:aliasId/verify - Verify alias
aliasRoutes.post('/:aliasId/verify', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { aliasId } = req.params;
    const { code } = req.body;

    const alias = await prisma.alias.findFirst({
      where: {
        id: aliasId,
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

    if (alias.isVerified) {
      res.json({ success: true, message: 'Alias already verified' });
      return;
    }

    // For Phase 1, accept any 6-digit code for EMAIL/PHONE verification
    // In production, this would validate against a sent verification code
    if (alias.type === 'EMAIL' || alias.type === 'PHONE') {
      if (!code || !/^\d{6}$/.test(code)) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid verification code. Must be 6 digits.',
        });
        return;
      }

      // For development, accept "123456" as valid code
      if (process.env.NODE_ENV === 'development' || code === '123456') {
        await prisma.alias.update({
          where: { id: aliasId },
          data: {
            isVerified: true,
            verifiedAt: new Date(),
          },
        });

        res.json({ success: true });
        return;
      }

      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid verification code',
      });
      return;
    }

    // USERNAME and RANDOM_KEY don't need verification
    res.json({ success: true, message: 'No verification needed for this alias type' });
  } catch (error) {
    console.error('Verify alias error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to verify alias',
    });
  }
});

// PUT /api/v1/aliases/:aliasId/primary - Set as primary alias
aliasRoutes.put('/:aliasId/primary', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { aliasId } = req.params;

    const alias = await prisma.alias.findFirst({
      where: {
        id: aliasId,
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

    // Unset other primary aliases
    await prisma.alias.updateMany({
      where: {
        userId: user.userId,
        bsimId: user.bsimId,
        isPrimary: true,
      },
      data: { isPrimary: false },
    });

    // Set this alias as primary
    await prisma.alias.update({
      where: { id: aliasId },
      data: { isPrimary: true },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Set primary alias error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to set primary alias',
    });
  }
});

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

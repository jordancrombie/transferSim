import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { config } from '../config/index.js';
import { normalizeAlias } from '../utils/normalize.js';
import { AliasType } from '@prisma/client';
import { BsimClient } from '../services/bsimClient.js';

export const internalRoutes = Router();

/**
 * Internal API authentication middleware
 * Validates X-Internal-Api-Key header against shared secret
 */
function requireInternalAuth(req: Request, res: Response, next: () => void): void {
  const apiKey = req.headers['x-internal-api-key'] as string;

  if (!config.wsim.internalApiKey) {
    console.warn('[Internal API] WSIM internal API key not configured');
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'Internal API not configured',
    });
    return;
  }

  if (!apiKey || apiKey !== config.wsim.internalApiKey) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing internal API key',
    });
    return;
  }

  next();
}

// Validation schema for alias resolution
const resolveAliasSchema = z.object({
  alias: z.string().min(1),
  type: z.enum(['EMAIL', 'PHONE', 'USERNAME', 'RANDOM_KEY']).optional(),
});

/**
 * POST /api/internal/aliases/resolve - Resolve alias to user details
 *
 * Used by WSIM for ContractSim counterparty resolution.
 * Returns userId, bsimId, and displayName for a verified alias.
 */
internalRoutes.post('/aliases/resolve', requireInternalAuth, async (req: Request, res: Response) => {
  try {
    const body = resolveAliasSchema.parse(req.body);

    // Determine alias type if not provided
    let aliasType: AliasType | undefined;
    if (body.type) {
      aliasType = body.type as AliasType;
    } else {
      aliasType = inferAliasType(body.alias);
    }

    if (!aliasType) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Could not determine alias type. Please provide type parameter.',
      });
      return;
    }

    const normalizedValue = normalizeAlias(aliasType, body.alias);

    const alias = await prisma.alias.findFirst({
      where: {
        type: aliasType,
        normalizedValue,
        isActive: true,
        isVerified: true,
      },
    });

    if (!alias) {
      res.json({
        found: false,
      });
      return;
    }

    // Get display name from BSIM
    let displayName: string | undefined;
    const bsimClient = await BsimClient.forBsim(alias.bsimId);
    if (bsimClient) {
      const verifyResult = await bsimClient.verifyUser({ userId: alias.userId });
      if (verifyResult.exists && verifyResult.displayName) {
        displayName = verifyResult.displayName;
      }
    }

    console.log(`[Internal API] Resolved alias ${body.alias} -> ${alias.userId}@${alias.bsimId}`);

    res.json({
      found: true,
      userId: alias.userId,
      bsimId: alias.bsimId,
      displayName: displayName || 'Unknown',
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
    console.error('[Internal API] Resolve alias error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to resolve alias',
    });
  }
});

/**
 * Helper to infer alias type from value
 */
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

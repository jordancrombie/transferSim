import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { BeaconContext } from '@prisma/client';
import {
  registerBeaconToken,
  lookupBeaconTokens,
  deregisterBeaconToken
} from '../services/discoveryService.js';

export const discoveryRoutes = Router();

// Validation schemas
const registerBeaconSchema = z.object({
  context: z.enum(['P2P_RECEIVE', 'MERCHANT_RECEIVE']),
  expiresIn: z.number().int().min(60).max(600).optional(),
  metadata: z.object({
    amount: z.number().positive().optional(),
    description: z.string().max(200).optional()
  }).optional()
});

const lookupBeaconsSchema = z.object({
  tokens: z.array(z.string().length(8)).min(1).max(20),
  rssiFilter: z.object({
    minRssi: z.number().int().min(-100).max(0).optional()
  }).optional()
});

/**
 * POST /api/v1/discovery/beacon/register
 *
 * Register a new beacon token for BLE broadcasting.
 * Returns major/minor values for iBeacon advertisement.
 */
discoveryRoutes.post('/beacon/register', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = registerBeaconSchema.parse(req.body);
    const user = req.user!;

    const result = await registerBeaconToken({
      userId: user.userId,
      bsimId: user.bsimId,
      context: body.context as BeaconContext,
      expiresIn: body.expiresIn,
      metadata: body.metadata
    });

    if ('error' in result) {
      if (result.retryAfter) {
        res.set('Retry-After', String(result.retryAfter));
        res.status(429).json({
          error: 'Too Many Requests',
          message: result.error,
          retryAfter: result.retryAfter
        });
        return;
      }
      res.status(500).json({
        error: 'Internal Server Error',
        message: result.error
      });
      return;
    }

    const { registration, rateLimit } = result;

    res.set('X-RateLimit-Remaining', String(rateLimit.remaining));
    res.set('X-RateLimit-Reset', rateLimit.resetAt.toISOString());

    res.status(201).json({
      beaconToken: registration.beaconToken,
      major: registration.major,
      minor: registration.minor,
      expiresAt: registration.expiresAt.toISOString(),
      ttlSeconds: registration.ttlSeconds
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid request body',
        details: error.errors
      });
      return;
    }
    console.error('[Discovery] Register error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to register beacon'
    });
  }
});

/**
 * POST /api/v1/discovery/beacon/lookup
 *
 * Look up beacon tokens to get recipient info.
 * Supports batch lookup of up to 20 tokens.
 */
discoveryRoutes.post('/beacon/lookup', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = lookupBeaconsSchema.parse(req.body);
    const user = req.user!;

    const result = await lookupBeaconTokens({
      userId: user.userId,
      bsimId: user.bsimId,
      tokens: body.tokens
    });

    if ('error' in result) {
      if (result.retryAfter) {
        res.set('Retry-After', String(result.retryAfter));
        res.status(429).json({
          error: 'Too Many Requests',
          message: result.error,
          retryAfter: result.retryAfter
        });
        return;
      }
      res.status(400).json({
        error: 'Bad Request',
        message: result.error
      });
      return;
    }

    const { results, rateLimit } = result;

    res.set('X-RateLimit-Remaining', String(rateLimit.remaining));
    res.set('X-RateLimit-Reset', rateLimit.resetAt.toISOString());

    res.json({
      results,
      rateLimitRemaining: rateLimit.remaining,
      rateLimitReset: rateLimit.resetAt.toISOString()
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid request body',
        details: error.errors
      });
      return;
    }
    console.error('[Discovery] Lookup error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to lookup beacons'
    });
  }
});

/**
 * DELETE /api/v1/discovery/beacon/:token
 *
 * Deregister a beacon token.
 * Called when user stops broadcasting or navigates away.
 */
discoveryRoutes.delete('/beacon/:token', requireAuth, async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const user = req.user!;

    if (!token || token.length !== 8) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid beacon token format'
      });
      return;
    }

    const result = await deregisterBeaconToken({
      userId: user.userId,
      bsimId: user.bsimId,
      token
    });

    if (!result.success) {
      res.status(403).json({
        error: 'Forbidden',
        message: result.error || 'Failed to deregister beacon'
      });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Discovery] Deregister error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to deregister beacon'
    });
  }
});

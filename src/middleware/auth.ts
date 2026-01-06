import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import crypto from 'crypto';

// Extend Express Request type
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      orchestrator?: {
        id: string;
        orchestratorId: string;
        name: string;
        canEnrollUsers: boolean;
        canInitiateTransfers: boolean;
        canViewTransfers: boolean;
      };
      user?: {
        userId: string;
        bsimId: string;
        email?: string;
      };
    }
  }
}

// Hash API key for comparison
function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

// Authenticate orchestrator via API key
export async function authenticateOrchestrator(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing API key. Provide X-API-Key header.',
    });
    return;
  }

  try {
    const apiKeyHash = hashApiKey(apiKey);
    const orchestrator = await prisma.orchestrator.findFirst({
      where: {
        apiKeyHash,
        isActive: true,
      },
    });

    if (!orchestrator) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key',
      });
      return;
    }

    req.orchestrator = {
      id: orchestrator.id,
      orchestratorId: orchestrator.orchestratorId,
      name: orchestrator.name,
      canEnrollUsers: orchestrator.canEnrollUsers,
      canInitiateTransfers: orchestrator.canInitiateTransfers,
      canViewTransfers: orchestrator.canViewTransfers,
    };

    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed',
    });
  }
}

// Extract user context from JWT (simplified for Phase 1)
// In production, this would validate JWT from BSIM auth-server
export async function extractUserContext(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header',
    });
    return;
  }

  // For Phase 1, we'll accept a simple format: userId:bsimId
  // In production, this would be a proper JWT validation
  const token = authHeader.substring(7);

  // Check if it's a development token (userId:bsimId format)
  if (token.includes(':')) {
    const [userId, bsimId] = token.split(':');
    if (userId && bsimId) {
      req.user = { userId, bsimId };
      next();
      return;
    }
  }

  // TODO: Implement proper JWT validation in Phase 2
  res.status(401).json({
    error: 'Unauthorized',
    message: 'Invalid token format',
  });
}

// Require both orchestrator and user context
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  await authenticateOrchestrator(req, res, async () => {
    if (res.headersSent) return;
    await extractUserContext(req, res, next);
  });
}

// Check specific orchestrator permissions
export function requirePermission(permission: 'canEnrollUsers' | 'canInitiateTransfers' | 'canViewTransfers') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.orchestrator) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Orchestrator authentication required',
      });
      return;
    }

    if (!req.orchestrator[permission]) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Orchestrator does not have ${permission} permission`,
      });
      return;
    }

    next();
  };
}

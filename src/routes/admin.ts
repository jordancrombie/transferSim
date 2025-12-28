import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { generateOrchestratorId, generateApiKey, hashApiKey } from '../utils/id.js';

export const adminRoutes = Router();

// Simple admin API key check (for Phase 1)
// In production, this would use proper admin authentication
function checkAdminKey(req: Request, res: Response): boolean {
  const adminKey = req.headers['x-admin-key'] as string;
  const expectedKey = process.env.ADMIN_API_KEY || 'dev-admin-key';

  if (!adminKey || adminKey !== expectedKey) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid admin key',
    });
    return false;
  }
  return true;
}

// Validation schemas
const createOrchestratorSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['MOBILE_APP', 'WEB_APP', 'TERMINAL']),
  webhookUrl: z.string().url().optional(),
  canEnrollUsers: z.boolean().optional().default(true),
  canInitiateTransfers: z.boolean().optional().default(true),
  canViewTransfers: z.boolean().optional().default(true),
  dailyTransferLimit: z.number().positive().optional(),
  perTransferLimit: z.number().positive().optional(),
});

const createBsimConnectionSchema = z.object({
  bsimId: z.string().min(1),
  name: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  authServerUrl: z.string().url(),
  openBankingUrl: z.string().url(),
  supportsPaymentInitiation: z.boolean().optional().default(false),
  supportsInstantTransfer: z.boolean().optional().default(true),
});

// POST /api/v1/admin/orchestrators - Register new orchestrator
adminRoutes.post('/orchestrators', async (req: Request, res: Response) => {
  if (!checkAdminKey(req, res)) return;

  try {
    const body = createOrchestratorSchema.parse(req.body);

    const apiKey = generateApiKey();
    const apiKeyHashed = hashApiKey(apiKey);

    const orchestrator = await prisma.orchestrator.create({
      data: {
        orchestratorId: generateOrchestratorId(),
        name: body.name,
        type: body.type,
        apiKey: apiKey.substring(0, 12) + '...',  // Store truncated for reference
        apiKeyHash: apiKeyHashed,
        webhookUrl: body.webhookUrl,
        canEnrollUsers: body.canEnrollUsers,
        canInitiateTransfers: body.canInitiateTransfers,
        canViewTransfers: body.canViewTransfers,
        dailyTransferLimit: body.dailyTransferLimit,
        perTransferLimit: body.perTransferLimit,
      },
    });

    // Return full API key only once - it won't be retrievable again
    res.status(201).json({
      orchestratorId: orchestrator.orchestratorId,
      name: orchestrator.name,
      type: orchestrator.type,
      apiKey: apiKey,  // Full key, only shown once
      webhookUrl: orchestrator.webhookUrl,
      permissions: {
        canEnrollUsers: orchestrator.canEnrollUsers,
        canInitiateTransfers: orchestrator.canInitiateTransfers,
        canViewTransfers: orchestrator.canViewTransfers,
      },
      limits: {
        dailyTransferLimit: orchestrator.dailyTransferLimit?.toString(),
        perTransferLimit: orchestrator.perTransferLimit?.toString(),
      },
      createdAt: orchestrator.createdAt,
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
    console.error('Create orchestrator error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create orchestrator',
    });
  }
});

// GET /api/v1/admin/orchestrators - List orchestrators
adminRoutes.get('/orchestrators', async (req: Request, res: Response) => {
  if (!checkAdminKey(req, res)) return;

  try {
    const orchestrators = await prisma.orchestrator.findMany({
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      orchestrators: orchestrators.map((o) => ({
        orchestratorId: o.orchestratorId,
        name: o.name,
        type: o.type,
        apiKeyPreview: o.apiKey,  // Truncated version
        webhookUrl: o.webhookUrl,
        permissions: {
          canEnrollUsers: o.canEnrollUsers,
          canInitiateTransfers: o.canInitiateTransfers,
          canViewTransfers: o.canViewTransfers,
        },
        limits: {
          dailyTransferLimit: o.dailyTransferLimit?.toString(),
          perTransferLimit: o.perTransferLimit?.toString(),
        },
        isActive: o.isActive,
        createdAt: o.createdAt,
      })),
    });
  } catch (error) {
    console.error('List orchestrators error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list orchestrators',
    });
  }
});

// PATCH /api/v1/admin/orchestrators/:orchestratorId - Update orchestrator
adminRoutes.patch('/orchestrators/:orchestratorId', async (req: Request, res: Response) => {
  if (!checkAdminKey(req, res)) return;

  try {
    const { orchestratorId } = req.params;
    const body = req.body;

    const orchestrator = await prisma.orchestrator.findUnique({
      where: { orchestratorId },
    });

    if (!orchestrator) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Orchestrator not found',
      });
      return;
    }

    const updated = await prisma.orchestrator.update({
      where: { orchestratorId },
      data: {
        name: body.name,
        webhookUrl: body.webhookUrl,
        canEnrollUsers: body.canEnrollUsers,
        canInitiateTransfers: body.canInitiateTransfers,
        canViewTransfers: body.canViewTransfers,
        dailyTransferLimit: body.dailyTransferLimit,
        perTransferLimit: body.perTransferLimit,
        isActive: body.isActive,
      },
    });

    res.json({
      orchestratorId: updated.orchestratorId,
      name: updated.name,
      isActive: updated.isActive,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    console.error('Update orchestrator error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update orchestrator',
    });
  }
});

// POST /api/v1/admin/orchestrators/:orchestratorId/rotate-key - Rotate API key
adminRoutes.post('/orchestrators/:orchestratorId/rotate-key', async (req: Request, res: Response) => {
  if (!checkAdminKey(req, res)) return;

  try {
    const { orchestratorId } = req.params;

    const orchestrator = await prisma.orchestrator.findUnique({
      where: { orchestratorId },
    });

    if (!orchestrator) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Orchestrator not found',
      });
      return;
    }

    const newApiKey = generateApiKey();
    const newApiKeyHash = hashApiKey(newApiKey);

    await prisma.orchestrator.update({
      where: { orchestratorId },
      data: {
        apiKey: newApiKey.substring(0, 12) + '...',
        apiKeyHash: newApiKeyHash,
      },
    });

    res.json({
      orchestratorId,
      apiKey: newApiKey,  // Full key, only shown once
    });
  } catch (error) {
    console.error('Rotate API key error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to rotate API key',
    });
  }
});

// POST /api/v1/admin/bsims - Register BSIM connection
adminRoutes.post('/bsims', async (req: Request, res: Response) => {
  if (!checkAdminKey(req, res)) return;

  try {
    const body = createBsimConnectionSchema.parse(req.body);

    // Check if bsimId already exists
    const existing = await prisma.bsimConnection.findUnique({
      where: { bsimId: body.bsimId },
    });

    if (existing) {
      res.status(409).json({
        error: 'Conflict',
        message: 'BSIM connection with this ID already exists',
      });
      return;
    }

    const connection = await prisma.bsimConnection.create({
      data: {
        bsimId: body.bsimId,
        name: body.name,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        authServerUrl: body.authServerUrl,
        openBankingUrl: body.openBankingUrl,
        supportsPaymentInitiation: body.supportsPaymentInitiation,
        supportsInstantTransfer: body.supportsInstantTransfer,
      },
    });

    res.status(201).json({
      bsimId: connection.bsimId,
      name: connection.name,
      baseUrl: connection.baseUrl,
      authServerUrl: connection.authServerUrl,
      openBankingUrl: connection.openBankingUrl,
      capabilities: {
        supportsPaymentInitiation: connection.supportsPaymentInitiation,
        supportsInstantTransfer: connection.supportsInstantTransfer,
      },
      createdAt: connection.createdAt,
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
    console.error('Create BSIM connection error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create BSIM connection',
    });
  }
});

// GET /api/v1/admin/bsims - List BSIM connections
adminRoutes.get('/bsims', async (req: Request, res: Response) => {
  if (!checkAdminKey(req, res)) return;

  try {
    const connections = await prisma.bsimConnection.findMany({
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      bsims: connections.map((c) => ({
        bsimId: c.bsimId,
        name: c.name,
        baseUrl: c.baseUrl,
        authServerUrl: c.authServerUrl,
        openBankingUrl: c.openBankingUrl,
        capabilities: {
          supportsPaymentInitiation: c.supportsPaymentInitiation,
          supportsInstantTransfer: c.supportsInstantTransfer,
        },
        isActive: c.isActive,
        createdAt: c.createdAt,
      })),
    });
  } catch (error) {
    console.error('List BSIM connections error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list BSIM connections',
    });
  }
});

// PATCH /api/v1/admin/bsims/:bsimId - Update BSIM connection
adminRoutes.patch('/bsims/:bsimId', async (req: Request, res: Response) => {
  if (!checkAdminKey(req, res)) return;

  try {
    const { bsimId } = req.params;
    const body = req.body;

    const connection = await prisma.bsimConnection.findUnique({
      where: { bsimId },
    });

    if (!connection) {
      res.status(404).json({
        error: 'Not Found',
        message: 'BSIM connection not found',
      });
      return;
    }

    const updated = await prisma.bsimConnection.update({
      where: { bsimId },
      data: {
        name: body.name,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        authServerUrl: body.authServerUrl,
        openBankingUrl: body.openBankingUrl,
        supportsPaymentInitiation: body.supportsPaymentInitiation,
        supportsInstantTransfer: body.supportsInstantTransfer,
        isActive: body.isActive,
      },
    });

    res.json({
      bsimId: updated.bsimId,
      name: updated.name,
      isActive: updated.isActive,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    console.error('Update BSIM connection error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update BSIM connection',
    });
  }
});

// GET /api/v1/admin/stats - Get system statistics
adminRoutes.get('/stats', async (req: Request, res: Response) => {
  if (!checkAdminKey(req, res)) return;

  try {
    const [
      totalAliases,
      verifiedAliases,
      totalTransfers,
      completedTransfers,
      totalOrchestrators,
      activeOrchestrators,
      totalBsims,
    ] = await Promise.all([
      prisma.alias.count({ where: { isActive: true } }),
      prisma.alias.count({ where: { isActive: true, isVerified: true } }),
      prisma.transfer.count(),
      prisma.transfer.count({ where: { status: 'COMPLETED' } }),
      prisma.orchestrator.count(),
      prisma.orchestrator.count({ where: { isActive: true } }),
      prisma.bsimConnection.count({ where: { isActive: true } }),
    ]);

    res.json({
      aliases: {
        total: totalAliases,
        verified: verifiedAliases,
      },
      transfers: {
        total: totalTransfers,
        completed: completedTransfers,
      },
      orchestrators: {
        total: totalOrchestrators,
        active: activeOrchestrators,
      },
      bsims: {
        connected: totalBsims,
      },
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get stats',
    });
  }
});

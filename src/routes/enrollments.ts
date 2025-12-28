import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

export const enrollmentRoutes = Router();

// Validation schemas
const createEnrollmentSchema = z.object({
  consentScopes: z.array(z.string()).min(1),
  consentExpiresAt: z.string().datetime().optional(),
});

// POST /api/v1/enrollments - Enroll user in P2P network
enrollmentRoutes.post('/', requireAuth, requirePermission('canEnrollUsers'), async (req: Request, res: Response) => {
  try {
    const body = createEnrollmentSchema.parse(req.body);
    const user = req.user!;
    const orchestrator = req.orchestrator!;

    // Check if already enrolled
    const existing = await prisma.userEnrollment.findUnique({
      where: {
        userId_bsimId_orchestratorId: {
          userId: user.userId,
          bsimId: user.bsimId,
          orchestratorId: orchestrator.orchestratorId,
        },
      },
    });

    if (existing && existing.isActive) {
      res.status(409).json({
        error: 'Conflict',
        message: 'User is already enrolled with this orchestrator',
      });
      return;
    }

    // Create or reactivate enrollment
    const enrollment = existing
      ? await prisma.userEnrollment.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            consentScopes: body.consentScopes,
            consentExpiresAt: body.consentExpiresAt ? new Date(body.consentExpiresAt) : null,
            enrolledAt: new Date(),
          },
        })
      : await prisma.userEnrollment.create({
          data: {
            userId: user.userId,
            bsimId: user.bsimId,
            orchestratorId: orchestrator.orchestratorId,
            consentScopes: body.consentScopes,
            consentExpiresAt: body.consentExpiresAt ? new Date(body.consentExpiresAt) : null,
          },
        });

    res.status(201).json({
      enrollmentId: enrollment.id,
      userId: enrollment.userId,
      bsimId: enrollment.bsimId,
      orchestratorId: enrollment.orchestratorId,
      consentScopes: enrollment.consentScopes,
      enrolledAt: enrollment.enrolledAt,
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
    console.error('Create enrollment error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create enrollment',
    });
  }
});

// GET /api/v1/enrollments - List user's enrollments
enrollmentRoutes.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const enrollments = await prisma.userEnrollment.findMany({
      where: {
        userId: user.userId,
        bsimId: user.bsimId,
        isActive: true,
      },
      orderBy: { enrolledAt: 'desc' },
    });

    // Get orchestrator names
    const orchestratorIds = enrollments.map((e) => e.orchestratorId);
    const orchestrators = await prisma.orchestrator.findMany({
      where: { orchestratorId: { in: orchestratorIds } },
      select: { orchestratorId: true, name: true },
    });
    const orchestratorMap = new Map(orchestrators.map((o) => [o.orchestratorId, o.name]));

    res.json({
      enrollments: enrollments.map((e) => ({
        enrollmentId: e.id,
        orchestratorId: e.orchestratorId,
        orchestratorName: orchestratorMap.get(e.orchestratorId) || 'Unknown',
        consentScopes: e.consentScopes,
        consentExpiresAt: e.consentExpiresAt,
        enrolledAt: e.enrolledAt,
      })),
    });
  } catch (error) {
    console.error('List enrollments error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list enrollments',
    });
  }
});

// GET /api/v1/enrollments/check - Check if user is enrolled with current orchestrator
enrollmentRoutes.get('/check', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const orchestrator = req.orchestrator!;

    const enrollment = await prisma.userEnrollment.findUnique({
      where: {
        userId_bsimId_orchestratorId: {
          userId: user.userId,
          bsimId: user.bsimId,
          orchestratorId: orchestrator.orchestratorId,
        },
      },
    });

    const isEnrolled = enrollment?.isActive ?? false;
    const isExpired = enrollment?.consentExpiresAt
      ? enrollment.consentExpiresAt < new Date()
      : false;

    res.json({
      enrolled: isEnrolled && !isExpired,
      enrollment: isEnrolled
        ? {
            enrollmentId: enrollment!.id,
            consentScopes: enrollment!.consentScopes,
            consentExpiresAt: enrollment!.consentExpiresAt,
            enrolledAt: enrollment!.enrolledAt,
          }
        : null,
    });
  } catch (error) {
    console.error('Check enrollment error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to check enrollment',
    });
  }
});

// DELETE /api/v1/enrollments/:enrollmentId - Remove enrollment
enrollmentRoutes.delete('/:enrollmentId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { enrollmentId } = req.params;
    const user = req.user!;

    const enrollment = await prisma.userEnrollment.findFirst({
      where: {
        id: enrollmentId,
        userId: user.userId,
        bsimId: user.bsimId,
      },
    });

    if (!enrollment) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Enrollment not found',
      });
      return;
    }

    // Soft delete
    await prisma.userEnrollment.update({
      where: { id: enrollmentId },
      data: { isActive: false },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete enrollment error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete enrollment',
    });
  }
});

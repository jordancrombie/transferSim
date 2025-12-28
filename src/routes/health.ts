import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';

export const healthRoutes = Router();

healthRoutes.get('/', async (_req: Request, res: Response) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'transfersim',
    version: process.env.npm_package_version || '0.1.0',
  };

  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ...health, database: 'connected' });
  } catch {
    res.status(503).json({ ...health, status: 'degraded', database: 'disconnected' });
  }
});

healthRoutes.get('/ready', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ready: true });
  } catch {
    res.status(503).json({ ready: false });
  }
});

healthRoutes.get('/live', (_req: Request, res: Response) => {
  res.json({ live: true });
});

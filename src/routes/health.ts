import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Read version from package.json at startup (works in Docker and npm start)
// Using __dirname which is available in CommonJS context after TypeScript compilation
const packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));
const VERSION = packageJson.version;

export const healthRoutes = Router();

healthRoutes.get('/', async (_req: Request, res: Response) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'transfersim',
    version: VERSION,
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

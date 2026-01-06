import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { config } from './config/index.js';
import { aliasRoutes } from './routes/aliases.js';
import { transferRoutes } from './routes/transfers.js';
import { tokenRoutes } from './routes/tokens.js';
import { enrollmentRoutes } from './routes/enrollments.js';
import { adminRoutes } from './routes/admin.js';
import { healthRoutes } from './routes/health.js';
import { microMerchantRoutes } from './routes/micro-merchants.js';

export function createApp(): Express {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: config.isDev ? '*' : process.env.CORS_ORIGIN,
    credentials: true,
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve .well-known files for Universal Links (Apple) and App Links (Android)
  // These must be served with correct content-type for Apple verification
  // Use process.cwd() to get project root - works for both dev and production
  const wellKnownDir = path.join(process.cwd(), 'public', '.well-known');
  app.use('/.well-known', express.static(wellKnownDir, {
    setHeaders: (res, filePath) => {
      // Apple requires application/json for AASA file
      if (filePath.endsWith('apple-app-site-association')) {
        res.setHeader('Content-Type', 'application/json');
      }
    },
  }));

  // Health check (no auth required)
  app.use('/health', healthRoutes);

  // API routes
  app.use('/api/v1/aliases', aliasRoutes);
  app.use('/api/v1/transfers', transferRoutes);
  app.use('/api/v1/tokens', tokenRoutes);
  app.use('/api/v1/enrollments', enrollmentRoutes);
  app.use('/api/v1/micro-merchants', microMerchantRoutes);
  app.use('/api/v1/admin', adminRoutes);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not Found',
      message: 'The requested resource does not exist',
    });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: config.isDev ? err.message : 'An unexpected error occurred',
    });
  });

  return app;
}

import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Service
  port: parseInt(process.env.PORT || '3010', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',

  // Database
  databaseUrl: process.env.DATABASE_URL || '',

  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },

  // BSIM
  bsim: {
    defaultUrl: process.env.BSIM_DEFAULT_URL || 'http://localhost:3001',
    defaultApiKey: process.env.BSIM_DEFAULT_API_KEY || '',
  },

  // JWT
  jwt: {
    publicKeyUrl: process.env.JWT_PUBLIC_KEY_URL || '',
    issuer: process.env.JWT_ISSUER || '',
  },

  // Webhooks
  webhookSecret: process.env.WEBHOOK_SECRET || '',

  // Transfer Limits
  limits: {
    defaultTransferLimit: parseFloat(process.env.DEFAULT_TRANSFER_LIMIT || '10000'),
    defaultDailyLimit: parseFloat(process.env.DEFAULT_DAILY_LIMIT || '50000'),
  },

  // Token expiry (in seconds)
  tokenExpirySeconds: 300, // 5 minutes
};

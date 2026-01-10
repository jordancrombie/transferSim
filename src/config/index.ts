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

  // Webhooks (incoming - from orchestrators)
  webhookSecret: process.env.WEBHOOK_SECRET || '',

  // Webhooks (outgoing - to WSIM for push notifications)
  webhooks: {
    wsimNotificationUrl: process.env.WSIM_WEBHOOK_URL || '',
    wsimNotificationSecret: process.env.WSIM_WEBHOOK_SECRET || '',
  },

  // WSIM Internal API (for profile image lookup)
  wsim: {
    internalApiUrl: process.env.WSIM_INTERNAL_API_URL || '',
    internalApiKey: process.env.WSIM_INTERNAL_API_KEY || '',
  },

  // Transfer Limits
  limits: {
    defaultTransferLimit: parseFloat(process.env.DEFAULT_TRANSFER_LIMIT || '10000'),
    defaultDailyLimit: parseFloat(process.env.DEFAULT_DAILY_LIMIT || '50000'),
  },

  // Token expiry (in seconds)
  tokenExpirySeconds: 300, // 5 minutes

  // Universal Links for QR codes
  // Used to generate scannable URLs that open mwsim app directly
  universalLinkBaseUrl: process.env.UNIVERSAL_LINK_BASE_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://transfer.banksim.ca'
      : 'https://transfersim-dev.banksim.ca'),

  // AWS S3 (for merchant logo storage)
  aws: {
    region: process.env.AWS_REGION || 'ca-central-1',
    s3BucketProfiles: process.env.AWS_S3_BUCKET_PROFILES || 'banksim-profiles-tsim-dev',
  },

  // CDN (CloudFront) for serving images
  cdnBaseUrl: process.env.CDN_BASE_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://cdn.banksim.ca'
      : 'https://cdn-dev.banksim.ca'),
};

import { randomBytes } from 'crypto';
import { getRedisClient } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { BeaconContext } from '@prisma/client';
import { BsimClient } from './bsimClient.js';
import { WsimClient } from './wsimClient.js';
import { generateInitialsColor } from './imageService.js';

/**
 * Discovery Service for BLE Proximity-based recipient discovery
 *
 * Uses Redis for fast beacon token storage with TTL auto-expiry.
 * PostgreSQL is used for audit logging if needed.
 *
 * Token format: 32-bit hex string (e.g., "1A2B3C4D")
 * Split into major (upper 16 bits) and minor (lower 16 bits) for iBeacon.
 */

// Redis key prefixes
const BEACON_TOKEN_PREFIX = 'beacon:token:';
const RATE_LIMIT_REGISTER_PREFIX = 'rate:beacon:register:';
const RATE_LIMIT_LOOKUP_PREFIX = 'rate:beacon:lookup:';

// Rate limiting configuration
// Set DISCOVERY_RATE_LIMIT_DISABLED=true to disable rate limiting (for debugging)
const RATE_LIMIT_DISABLED = process.env.DISCOVERY_RATE_LIMIT_DISABLED === 'true';

const RATE_LIMITS = {
  register: {
    limit: 10,      // 10 registrations
    windowSec: 3600 // per hour
  },
  lookup: {
    limit: 60,      // 60 lookups
    windowSec: 60   // per minute
  },
  lookupBatchSize: 20 // max tokens per lookup request
};

// Default beacon TTL
const DEFAULT_BEACON_TTL_SEC = 300; // 5 minutes
const MAX_BEACON_TTL_SEC = 600;     // 10 minutes

export interface BeaconMetadata {
  amount?: number;
  description?: string;
}

export interface BeaconRegistration {
  beaconToken: string;
  major: number;
  minor: number;
  expiresAt: Date;
  ttlSeconds: number;
}

export interface BeaconData {
  userId: string;
  bsimId: string;
  context: BeaconContext;
  metadata: BeaconMetadata | null;
  expiresAt: string;
}

export interface RecipientInfo {
  displayName: string;
  bankName: string;
  profileImageUrl: string | null;
  initialsColor: string;
  isMerchant: boolean;
  merchantLogoUrl?: string;
  merchantCategory?: string;
  recipientAlias?: string;
  aliasType?: string;
}

export interface BeaconLookupResult {
  token: string;
  found: boolean;
  context?: BeaconContext;
  recipient?: RecipientInfo;
  metadata?: BeaconMetadata;
}

export interface RateLimitInfo {
  remaining: number;
  resetAt: Date;
}

/**
 * Generate a random 32-bit beacon token as hex string
 */
function generateBeaconToken(): string {
  const bytes = randomBytes(4);
  return bytes.toString('hex').toUpperCase();
}

/**
 * Split 32-bit token into major (high 16 bits) and minor (low 16 bits)
 */
function tokenToMajorMinor(token: string): { major: number; minor: number } {
  const value = parseInt(token, 16);
  return {
    major: (value >> 16) & 0xFFFF,
    minor: value & 0xFFFF
  };
}

/**
 * Check rate limit using Redis sliding window
 * Returns remaining count and reset time
 */
async function checkRateLimit(
  key: string,
  limit: number,
  windowSec: number
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const redis = getRedisClient();
  const now = Date.now();
  const windowStart = now - (windowSec * 1000);

  // Use Redis transaction for atomic operation
  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, 0, windowStart); // Remove old entries
  pipeline.zadd(key, now, `${now}`);              // Add current request
  pipeline.zcard(key);                            // Count entries
  pipeline.expire(key, windowSec);                // Set expiry

  const results = await pipeline.exec();
  const count = results?.[2]?.[1] as number || 0;

  const resetAt = new Date(now + (windowSec * 1000));
  const remaining = Math.max(0, limit - count);
  const allowed = count <= limit;

  return { allowed, remaining, resetAt };
}

/**
 * Register a new beacon token for BLE broadcasting
 */
export async function registerBeaconToken(params: {
  userId: string;
  bsimId: string;
  context: BeaconContext;
  expiresIn?: number;
  metadata?: BeaconMetadata;
}): Promise<{ registration: BeaconRegistration; rateLimit: RateLimitInfo } | { error: string; retryAfter?: number }> {
  const { userId, bsimId, context, metadata } = params;
  const ttlSeconds = Math.min(params.expiresIn || DEFAULT_BEACON_TTL_SEC, MAX_BEACON_TTL_SEC);

  // Check rate limit (can be disabled via DISCOVERY_RATE_LIMIT_DISABLED=true)
  let rateCheck = { allowed: true, remaining: 999, resetAt: new Date(Date.now() + 3600000) };
  if (!RATE_LIMIT_DISABLED) {
    const rateLimitKey = `${RATE_LIMIT_REGISTER_PREFIX}${bsimId}:${userId}`;
    rateCheck = await checkRateLimit(rateLimitKey, RATE_LIMITS.register.limit, RATE_LIMITS.register.windowSec);

    if (!rateCheck.allowed) {
      return {
        error: 'Rate limit exceeded for beacon registration',
        retryAfter: Math.ceil((rateCheck.resetAt.getTime() - Date.now()) / 1000)
      };
    }
  }

  const redis = getRedisClient();

  // Generate unique token (retry on collision)
  let beaconToken: string;
  let attempts = 0;
  const maxAttempts = 5;

  do {
    beaconToken = generateBeaconToken();
    const exists = await redis.exists(`${BEACON_TOKEN_PREFIX}${beaconToken}`);
    if (!exists) break;
    attempts++;
  } while (attempts < maxAttempts);

  if (attempts >= maxAttempts) {
    return { error: 'Failed to generate unique beacon token' };
  }

  const { major, minor } = tokenToMajorMinor(beaconToken);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  // Store in Redis with TTL
  const beaconData: BeaconData = {
    userId,
    bsimId,
    context,
    metadata: metadata || null,
    expiresAt: expiresAt.toISOString()
  };

  await redis.setex(
    `${BEACON_TOKEN_PREFIX}${beaconToken}`,
    ttlSeconds,
    JSON.stringify(beaconData)
  );

  // Also store in PostgreSQL for audit (optional, non-blocking)
  prisma.discoveryBeacon.create({
    data: {
      beaconToken,
      major,
      minor,
      userId,
      bsimId,
      context,
      metadata: metadata as object || undefined,
      expiresAt
    }
  }).catch(err => {
    console.warn('[Discovery] Failed to persist beacon to DB:', err.message);
  });

  console.log(`[Discovery] Registered beacon ${beaconToken} for ${bsimId}:${userId}, context=${context}, ttl=${ttlSeconds}s`);

  return {
    registration: {
      beaconToken,
      major,
      minor,
      expiresAt,
      ttlSeconds
    },
    rateLimit: {
      remaining: rateCheck.remaining - 1,
      resetAt: rateCheck.resetAt
    }
  };
}

/**
 * Look up beacon tokens (batch)
 * Returns recipient info for valid tokens
 */
export async function lookupBeaconTokens(params: {
  userId: string;
  bsimId: string;
  tokens: string[];
}): Promise<{ results: BeaconLookupResult[]; rateLimit: RateLimitInfo } | { error: string; retryAfter?: number }> {
  const { userId, bsimId, tokens } = params;

  // Validate batch size
  if (tokens.length > RATE_LIMITS.lookupBatchSize) {
    return { error: `Batch size exceeds limit of ${RATE_LIMITS.lookupBatchSize} tokens` };
  }

  // Check rate limit (can be disabled via DISCOVERY_RATE_LIMIT_DISABLED=true)
  let rateCheck = { allowed: true, remaining: 999, resetAt: new Date(Date.now() + 60000) };
  if (!RATE_LIMIT_DISABLED) {
    const rateLimitKey = `${RATE_LIMIT_LOOKUP_PREFIX}${bsimId}:${userId}`;
    rateCheck = await checkRateLimit(rateLimitKey, RATE_LIMITS.lookup.limit, RATE_LIMITS.lookup.windowSec);

    if (!rateCheck.allowed) {
      return {
        error: 'Rate limit exceeded for beacon lookup',
        retryAfter: Math.ceil((rateCheck.resetAt.getTime() - Date.now()) / 1000)
      };
    }
  }

  const redis = getRedisClient();
  const results: BeaconLookupResult[] = [];

  // Batch fetch from Redis
  const pipeline = redis.pipeline();
  for (const token of tokens) {
    pipeline.get(`${BEACON_TOKEN_PREFIX}${token.toUpperCase()}`);
  }
  const redisResults = await pipeline.exec();

  // Process each token
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].toUpperCase();
    const rawData = redisResults?.[i]?.[1] as string | null;

    if (!rawData) {
      results.push({ token, found: false });
      continue;
    }

    try {
      const beaconData: BeaconData = JSON.parse(rawData);

      // Don't return your own beacons
      if (beaconData.userId === userId && beaconData.bsimId === bsimId) {
        results.push({ token, found: false });
        continue;
      }

      // Fetch recipient info
      const recipientInfo = await getRecipientInfo(
        beaconData.userId,
        beaconData.bsimId,
        beaconData.context
      );

      results.push({
        token,
        found: true,
        context: beaconData.context,
        recipient: recipientInfo,
        metadata: beaconData.metadata || undefined
      });
    } catch (err) {
      console.error(`[Discovery] Error parsing beacon ${token}:`, err);
      results.push({ token, found: false });
    }
  }

  console.log(`[Discovery] Looked up ${tokens.length} tokens, found ${results.filter(r => r.found).length}`);

  return {
    results,
    rateLimit: {
      remaining: rateCheck.remaining - 1,
      resetAt: rateCheck.resetAt
    }
  };
}

/**
 * Deregister a beacon token
 */
export async function deregisterBeaconToken(params: {
  userId: string;
  bsimId: string;
  token: string;
}): Promise<{ success: boolean; error?: string }> {
  const { userId, bsimId, token } = params;
  const redis = getRedisClient();
  const key = `${BEACON_TOKEN_PREFIX}${token.toUpperCase()}`;

  // Verify ownership before deleting
  const rawData = await redis.get(key);
  if (!rawData) {
    return { success: true }; // Already gone, treat as success
  }

  try {
    const beaconData: BeaconData = JSON.parse(rawData);

    if (beaconData.userId !== userId || beaconData.bsimId !== bsimId) {
      return { success: false, error: 'Not authorized to deregister this beacon' };
    }

    await redis.del(key);

    // Mark as consumed in DB (for audit)
    prisma.discoveryBeacon.updateMany({
      where: { beaconToken: token.toUpperCase() },
      data: { consumedAt: new Date() }
    }).catch(err => {
      console.warn('[Discovery] Failed to mark beacon as consumed in DB:', err.message);
    });

    console.log(`[Discovery] Deregistered beacon ${token}`);
    return { success: true };
  } catch {
    return { success: false, error: 'Invalid beacon data' };
  }
}

/**
 * Get recipient display info from BSIM and WSIM
 */
async function getRecipientInfo(
  userId: string,
  bsimId: string,
  context: BeaconContext
): Promise<RecipientInfo> {
  let displayName = 'Unknown';
  let bankName = 'Unknown Bank';
  let profileImageUrl: string | null = null;
  let initialsColor = generateInitialsColor(`${bsimId}:${userId}`);
  let isMerchant = false;
  let merchantLogoUrl: string | undefined;
  let merchantCategory: string | undefined;
  let recipientAlias: string | undefined;
  let aliasType: string | undefined;

  // Get bank name from BSIM connection
  const bsimConnection = await prisma.bsimConnection.findUnique({
    where: { bsimId }
  });
  if (bsimConnection?.name) {
    bankName = bsimConnection.name;
  }

  // Get display name from BSIM
  const bsimClient = await BsimClient.forBsim(bsimId);
  if (bsimClient) {
    const verifyResult = await bsimClient.verifyUser({ userId });
    if (verifyResult.exists && verifyResult.displayName) {
      displayName = verifyResult.displayName;
    }
  }

  // Get profile image from WSIM
  const wsimClient = WsimClient.create();
  if (wsimClient) {
    const profile = await wsimClient.getProfile(userId, bsimId);
    if (profile.profileImageUrl) {
      profileImageUrl = profile.profileImageUrl;
    }
  }

  // Get primary alias for fallback transfer flow
  const primaryAlias = await prisma.alias.findFirst({
    where: {
      userId,
      bsimId,
      isActive: true,
      isPrimary: true
    }
  });
  if (primaryAlias) {
    recipientAlias = primaryAlias.value;
    aliasType = primaryAlias.type;
  } else {
    // Fall back to any active alias
    const anyAlias = await prisma.alias.findFirst({
      where: { userId, bsimId, isActive: true }
    });
    if (anyAlias) {
      recipientAlias = anyAlias.value;
      aliasType = anyAlias.type;
    }
  }

  // Check for merchant info if MERCHANT_RECEIVE context
  if (context === 'MERCHANT_RECEIVE') {
    const merchant = await prisma.microMerchant.findUnique({
      where: { userId_bsimId: { userId, bsimId } }
    });

    if (merchant?.isActive) {
      isMerchant = true;
      displayName = merchant.merchantName;
      merchantLogoUrl = merchant.logoImageUrl || undefined;
      merchantCategory = merchant.merchantCategory;
      initialsColor = merchant.initialsColor || initialsColor;
    }
  }

  return {
    displayName,
    bankName,
    profileImageUrl,
    initialsColor,
    isMerchant,
    merchantLogoUrl,
    merchantCategory,
    recipientAlias,
    aliasType
  };
}

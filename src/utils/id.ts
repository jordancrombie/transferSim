import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

// Generate prefixed external IDs for different entity types
export function generateTransferId(): string {
  return `p2p_${uuidv4().replace(/-/g, '').substring(0, 24)}`;
}

export function generateOrchestratorId(): string {
  return `orch_${uuidv4().replace(/-/g, '').substring(0, 24)}`;
}

export function generateTokenId(): string {
  return `tok_${uuidv4().replace(/-/g, '').substring(0, 24)}`;
}

export function generateMerchantId(): string {
  return `mm_${uuidv4().replace(/-/g, '').substring(0, 24)}`;
}

// Generate random key alias (8 alphanumeric characters)
export function generateRandomKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars (0, O, 1, I)
  let result = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

// Generate API key for orchestrators
export function generateApiKey(): string {
  return `tsim_${crypto.randomBytes(32).toString('hex')}`;
}

// Hash API key for storage
export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

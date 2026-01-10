import { createHmac } from 'crypto';
import { config } from '../config/index.js';

/**
 * Webhook Service for Push Notifications
 *
 * Sends transfer completion events to WSIM for push notification delivery.
 * Implements HMAC-SHA256 signing and exponential backoff retry.
 *
 * Per AD5 (Push Notification Q&A): Enhanced payload format agreed by all teams.
 */

// Webhook payload types per AD5
export interface TransferCompletedPayload {
  eventType: 'transfer.completed';
  timestamp: string;
  idempotencyKey: string;
  data: {
    transferId: string;
    recipientUserId: string;      // BSIM fiUserRef - WSIM looks up via BsimEnrollment
    recipientBsimId: string;      // Required for WSIM user lookup
    recipientAlias: string;
    recipientAliasType: string;
    recipientType: 'individual' | 'merchant';  // For mwsim dashboard refresh
    merchantName: string | null;               // Merchant name if recipientType is 'merchant'
    senderDisplayName: string;
    senderAlias: string | null;
    senderProfileImageUrl: string | null;      // URL to sender's profile image (from WSIM)
    recipientProfileImageUrl: string | null;   // URL to recipient's profile image (from WSIM)
    senderBankName: string;
    recipientBankName: string;
    amount: string;               // String to avoid floating point issues
    currency: string;
    description: string | null;
    isCrossBank: boolean;
  };
}

export type WebhookPayload = TransferCompletedPayload;

// Retry configuration: exponential backoff (1s, 2s, 4s, 8s, 16s)
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000];
const MAX_RETRIES = 5;

/**
 * Generate HMAC-SHA256 signature for webhook payload
 * Header format: X-Webhook-Signature: sha256=<hex>
 */
function signPayload(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send webhook with retry logic
 * Returns true if successful, false if all retries exhausted
 */
async function sendWithRetry(
  url: string,
  payload: WebhookPayload,
  secret: string
): Promise<boolean> {
  const body = JSON.stringify(payload);
  const signature = signPayload(body, secret);

  // Debug: Log full payload being sent
  console.log(`[Webhook] Sending ${payload.eventType} to ${url}`);
  console.log(`[Webhook] Full payload:`, JSON.stringify(payload, null, 2));

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
        },
        body,
      });

      if (response.ok) {
        console.log(`[Webhook] Success: ${payload.eventType} for ${payload.data.transferId}`);
        return true;
      }

      // Log non-2xx responses
      const responseText = await response.text().catch(() => 'No response body');
      console.warn(
        `[Webhook] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ` +
        `${response.status} ${response.statusText} - ${responseText}`
      );

      // Don't retry on 4xx client errors (except 429 rate limit)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        console.error(`[Webhook] Client error ${response.status}, not retrying`);
        return false;
      }
    } catch (error) {
      console.warn(
        `[Webhook] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ` +
        `${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // Wait before retry (unless this was the last attempt)
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
      console.log(`[Webhook] Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  console.error(
    `[Webhook] All ${MAX_RETRIES + 1} attempts failed for ${payload.eventType} ` +
    `transferId=${payload.data.transferId}. Dead-lettered.`
  );
  return false;
}

/**
 * Send transfer.completed webhook to WSIM
 * Fire-and-forget - does not block transfer completion
 */
export async function sendTransferCompletedWebhook(
  payload: TransferCompletedPayload
): Promise<void> {
  const webhookUrl = config.webhooks?.wsimNotificationUrl;
  const webhookSecret = config.webhooks?.wsimNotificationSecret;

  if (!webhookUrl) {
    console.log('[Webhook] WSIM notification URL not configured, skipping');
    return;
  }

  if (!webhookSecret) {
    console.warn('[Webhook] WSIM notification secret not configured, skipping');
    return;
  }

  // Fire-and-forget: don't await, let it run in background
  sendWithRetry(webhookUrl, payload, webhookSecret).catch((error) => {
    console.error('[Webhook] Unexpected error in sendWithRetry:', error);
  });
}

/**
 * Build transfer.completed payload from transfer data
 */
export function buildTransferCompletedPayload(params: {
  transferId: string;
  recipientUserId: string;
  recipientBsimId: string;
  recipientAlias: string;
  recipientAliasType: string;
  recipientType: 'individual' | 'merchant';
  merchantName: string | null;
  senderDisplayName: string;
  senderAlias: string | null;
  senderProfileImageUrl: string | null;
  recipientProfileImageUrl: string | null;
  senderBankName: string;
  recipientBankName: string;
  amount: string;
  currency: string;
  description: string | null;
  isCrossBank: boolean;
}): TransferCompletedPayload {
  return {
    eventType: 'transfer.completed',
    timestamp: new Date().toISOString(),
    idempotencyKey: params.transferId,
    data: {
      transferId: params.transferId,
      recipientUserId: params.recipientUserId,
      recipientBsimId: params.recipientBsimId,
      recipientAlias: params.recipientAlias,
      recipientAliasType: params.recipientAliasType,
      recipientType: params.recipientType,
      merchantName: params.merchantName,
      senderDisplayName: params.senderDisplayName,
      senderAlias: params.senderAlias,
      senderProfileImageUrl: params.senderProfileImageUrl,
      recipientProfileImageUrl: params.recipientProfileImageUrl,
      senderBankName: params.senderBankName,
      recipientBankName: params.recipientBankName,
      amount: params.amount,
      currency: params.currency,
      description: params.description,
      isCrossBank: params.isCrossBank,
    },
  };
}

import { createHmac } from 'crypto';
import { config } from '../config/index.js';

/**
 * Settlement Webhook Service
 *
 * Sends settlement completion events to ContractSim.
 * Implements HMAC-SHA256 signing and exponential backoff retry.
 */

// Webhook payload types
export interface SettlementCompletedPayload {
  event_id: string;
  event_type: 'settlement.completed';
  timestamp: string;
  data: {
    settlement_id: string;
    transfer_id: string | null;
    contract_id: string;
    status: 'completed';
    amount: string;
    from_wallet_id: string;
    to_wallet_id: string;
  };
}

export interface SettlementFailedPayload {
  event_id: string;
  event_type: 'settlement.failed';
  timestamp: string;
  data: {
    settlement_id: string;
    transfer_id: string | null;
    contract_id: string;
    status: 'failed';
    amount: string;
    from_wallet_id: string;
    to_wallet_id: string;
    error: string;
    error_message: string;
  };
}

export type SettlementWebhookPayload = SettlementCompletedPayload | SettlementFailedPayload;

// Retry configuration: exponential backoff (1s, 2s, 4s, 8s, 16s)
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000];
const MAX_RETRIES = 5;

/**
 * Generate HMAC-SHA256 signature for webhook payload
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
 * Generate unique event ID
 */
function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `evt_${timestamp}${random}`;
}

/**
 * Send webhook with retry logic
 */
async function sendWithRetry(
  url: string,
  payload: SettlementWebhookPayload,
  secret: string
): Promise<boolean> {
  const body = JSON.stringify(payload);
  const signature = signPayload(body, secret);

  console.log(`[Settlement Webhook] Sending ${payload.event_type} to ${url}`);

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
        console.log(`[Settlement Webhook] Success: ${payload.event_type} for ${payload.data.settlement_id}`);
        return true;
      }

      const responseText = await response.text().catch(() => 'No response body');
      console.warn(
        `[Settlement Webhook] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ` +
        `${response.status} ${response.statusText} - ${responseText}`
      );

      // Don't retry on 4xx client errors (except 429 rate limit)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        console.error(`[Settlement Webhook] Client error ${response.status}, not retrying`);
        return false;
      }
    } catch (error) {
      console.warn(
        `[Settlement Webhook] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ` +
        `${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // Wait before retry (unless this was the last attempt)
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
      console.log(`[Settlement Webhook] Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  console.error(
    `[Settlement Webhook] All ${MAX_RETRIES + 1} attempts failed for ${payload.event_type} ` +
    `settlementId=${payload.data.settlement_id}. Dead-lettered.`
  );
  return false;
}

/**
 * Send settlement webhook to ContractSim
 * Fire-and-forget - does not block settlement completion
 */
export async function sendSettlementWebhook(params: {
  settlementId: string;
  transferId: string | null;
  contractId: string;
  status: 'completed' | 'failed';
  amount: string;
  fromWalletId: string;
  toWalletId: string;
  error?: string;
  errorMessage?: string;
}): Promise<void> {
  const webhookUrl = config.contractSim.webhookUrl;
  const webhookSecret = config.contractSim.webhookSecret;

  if (!webhookUrl) {
    console.log('[Settlement Webhook] ContractSim webhook URL not configured, skipping');
    return;
  }

  if (!webhookSecret) {
    console.warn('[Settlement Webhook] ContractSim webhook secret not configured, skipping');
    return;
  }

  const eventId = generateEventId();
  const timestamp = new Date().toISOString();

  let payload: SettlementWebhookPayload;

  if (params.status === 'completed') {
    payload = {
      event_id: eventId,
      event_type: 'settlement.completed',
      timestamp,
      data: {
        settlement_id: params.settlementId,
        transfer_id: params.transferId,
        contract_id: params.contractId,
        status: 'completed',
        amount: params.amount,
        from_wallet_id: params.fromWalletId,
        to_wallet_id: params.toWalletId,
      },
    };
  } else {
    payload = {
      event_id: eventId,
      event_type: 'settlement.failed',
      timestamp,
      data: {
        settlement_id: params.settlementId,
        transfer_id: params.transferId,
        contract_id: params.contractId,
        status: 'failed',
        amount: params.amount,
        from_wallet_id: params.fromWalletId,
        to_wallet_id: params.toWalletId,
        error: params.error || 'UNKNOWN_ERROR',
        error_message: params.errorMessage || 'Settlement failed',
      },
    };
  }

  // Fire-and-forget
  sendWithRetry(webhookUrl, payload, webhookSecret).catch((error) => {
    console.error('[Settlement Webhook] Unexpected error in sendWithRetry:', error);
  });
}

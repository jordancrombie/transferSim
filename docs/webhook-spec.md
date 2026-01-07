# TransferSim Webhook Specification

## Overview

TransferSim sends HTTP POST webhooks to WSIM when transfers complete. WSIM uses these webhooks to trigger push notifications to recipient devices.

**Current Version:** v0.6.0
**Last Updated:** 2026-01-07

## Architecture Flow

```
TransferSim → HTTP Webhook → WSIM → Push Notification → mwsim (mobile app)
```

## Authentication

All webhooks are signed using HMAC-SHA256 with a shared secret.

| Header | Format | Description |
|--------|--------|-------------|
| `X-Webhook-Signature` | `sha256=<64 hex chars>` | HMAC-SHA256 signature of the raw request body |

### Verifying Signatures

```typescript
import { createHmac } from 'crypto';

function verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
  const expectedHmac = createHmac('sha256', secret);
  expectedHmac.update(body);
  const expectedSignature = `sha256=${expectedHmac.digest('hex')}`;
  return signature === expectedSignature;
}
```

## Retry Policy

TransferSim uses exponential backoff for failed webhook deliveries:

| Attempt | Delay | Total Elapsed |
|---------|-------|---------------|
| 1 | Immediate | 0s |
| 2 | 1s | 1s |
| 3 | 2s | 3s |
| 4 | 4s | 7s |
| 5 | 8s | 15s |
| 6 | 16s | 31s |

- **Max Retries:** 5 (6 total attempts)
- **Retry on:** 5xx errors, 429 (rate limit), network errors
- **No retry on:** 4xx client errors (except 429)

---

## Event: `transfer.completed`

Sent when a P2P transfer successfully completes (funds credited to recipient).

### Payload Structure

```typescript
interface TransferCompletedPayload {
  eventType: 'transfer.completed';
  timestamp: string;        // ISO 8601 format
  idempotencyKey: string;   // Same as transferId - use for deduplication
  data: {
    // Transfer identification
    transferId: string;

    // Recipient information (for WSIM user lookup)
    recipientUserId: string;
    recipientBsimId: string;
    recipientAlias: string;
    recipientAliasType: string;
    recipientType: 'individual' | 'merchant';
    merchantName: string | null;

    // Sender information (for notification display)
    senderDisplayName: string;
    senderAlias: string | null;
    senderBankName: string;
    recipientBankName: string;

    // Transfer details
    amount: string;
    currency: string;
    description: string | null;
    isCrossBank: boolean;
  };
}
```

### Field Reference

| Field | Type | Nullable | Values / Format | Description |
|-------|------|----------|-----------------|-------------|
| `eventType` | string | No | `"transfer.completed"` | Event type identifier |
| `timestamp` | string | No | ISO 8601 (`2026-01-07T12:34:56.789Z`) | When webhook was generated |
| `idempotencyKey` | string | No | Same as `transferId` | For deduplication |

#### data.* Fields

| Field | Type | Nullable | Values / Format | Description |
|-------|------|----------|-----------------|-------------|
| `transferId` | string | No | `p2p_<24 hex chars>` | Unique transfer identifier |
| `recipientUserId` | string | No | BSIM `fiUserRef` | WSIM looks up user via BsimEnrollment |
| `recipientBsimId` | string | No | `bsim_<id>` | Bank instance identifier |
| `recipientAlias` | string | No | `@username`, `email@`, `+1234567890` | Alias used for this transfer |
| `recipientAliasType` | string | No | `EMAIL`, `PHONE`, `USERNAME`, `RANDOM_KEY` | Type of alias (UPPERCASE) |
| `recipientType` | string | No | `individual`, `merchant` | Recipient category (**lowercase**) |
| `merchantName` | string | **Yes** | Business name or `null` | Only populated when `recipientType` is `"merchant"` |
| `senderDisplayName` | string | No | Display name | Sender's name for notification display |
| `senderAlias` | string | **Yes** | Alias or `null` | Sender's primary alias (may be null if none set) |
| `senderBankName` | string | No | Bank name | e.g., "Tangerine", "RBC" |
| `recipientBankName` | string | No | Bank name | Recipient's bank name |
| `amount` | string | No | Decimal string | e.g., `"100.00"` (string to avoid floating point issues) |
| `currency` | string | No | ISO 4217 | e.g., `"CAD"` |
| `description` | string | **Yes** | Transfer memo or `null` | Optional message from sender |
| `isCrossBank` | boolean | No | `true`, `false` | Whether sender and recipient banks differ |

---

## Example Payloads

### Individual-to-Individual Payment

```json
{
  "eventType": "transfer.completed",
  "timestamp": "2026-01-07T15:30:00.000Z",
  "idempotencyKey": "p2p_abc123def456789012345678",
  "data": {
    "transferId": "p2p_abc123def456789012345678",
    "recipientUserId": "usr_recipient123",
    "recipientBsimId": "bsim_tangerine",
    "recipientAlias": "@alice",
    "recipientAliasType": "USERNAME",
    "recipientType": "individual",
    "merchantName": null,
    "senderDisplayName": "Bob Smith",
    "senderAlias": "@bob",
    "senderBankName": "RBC",
    "recipientBankName": "Tangerine",
    "amount": "50.00",
    "currency": "CAD",
    "description": "Lunch money",
    "isCrossBank": true
  }
}
```

### Individual-to-Merchant Payment

```json
{
  "eventType": "transfer.completed",
  "timestamp": "2026-01-07T15:30:00.000Z",
  "idempotencyKey": "p2p_xyz789abc012345678901234",
  "data": {
    "transferId": "p2p_xyz789abc012345678901234",
    "recipientUserId": "usr_merchant456",
    "recipientBsimId": "bsim_tangerine",
    "recipientAlias": "@sarahsbakery",
    "recipientAliasType": "USERNAME",
    "recipientType": "merchant",
    "merchantName": "Sarah's Bakery",
    "senderDisplayName": "Bob Smith",
    "senderAlias": "@bob",
    "senderBankName": "Tangerine",
    "recipientBankName": "Tangerine",
    "amount": "25.00",
    "currency": "CAD",
    "description": "Coffee and croissant",
    "isCrossBank": false
  }
}
```

---

## Integration Notes

### For WSIM (Push Notification Service)

1. **User Lookup:** Use `recipientUserId` + `recipientBsimId` to find the user's device tokens via BsimEnrollment
2. **Deduplication:** Use `idempotencyKey` to prevent duplicate notifications
3. **Pass-through:** Include `recipientType` and `merchantName` in push payload for mwsim

### For mwsim (Mobile App)

1. **Dashboard Refresh:** When receiving a push notification where `recipientType === "merchant"`, trigger a merchant dashboard refresh
2. **Notification Display:** Use `senderDisplayName` and `amount` for notification content
3. **Values are lowercase:** `recipientType` is `"individual"` or `"merchant"` (not `INDIVIDUAL` or `MICRO_MERCHANT`)

---

## Configuration

TransferSim requires these environment variables for webhook delivery:

| Variable | Description |
|----------|-------------|
| `WSIM_WEBHOOK_URL` | WSIM notification endpoint (e.g., `https://wsim.banksim.ca/internal/notifications/webhook`) |
| `WSIM_WEBHOOK_SECRET` | Shared secret for HMAC-SHA256 signing |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.6.0 | 2026-01-07 | Initial documentation |
| 0.5.2 | 2026-01-07 | Added `recipientType` and `merchantName` fields |
| 0.3.0 | 2026-01-04 | Initial webhook implementation |

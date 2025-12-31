# TransferSim TODO

## Phase 2 - Production Hardening

### Critical Items

#### 1. JWT Validation (HIGH PRIORITY)
- **Location**: `src/middleware/auth.ts:114`
- **Current State**: Accepts development token format (`userId:bsimId`)
- **Required**: Implement proper JWT validation against BSIM auth-server
- **Details**:
  - Validate JWT signature using BSIM's public keys
  - Verify issuer and audience claims
  - Extract userId and bsimId from validated JWT claims
  - Handle token expiration and refresh
  - Coordinate with BSIM team for JWT format and public key distribution

#### 2. Transfer Reversal Mechanism (HIGH PRIORITY)
- **Location**: `src/routes/transfers.ts:427, 546`
- **Current State**: If credit fails after successful debit, transfer marked CREDIT_FAILED but debit not reversed
- **Required**: Implement automatic reversal for failed cross-bank transfers
- **Details**:
  - Create reversal transaction when credit fails after debit
  - Call BSIM credit API to return funds to original sender account
  - Track reversal transaction IDs in Transfer model
  - Handle reversal failures (alert/manual intervention)
  - Add REVERSED status to transfer lifecycle
  - Consider idempotency for retry scenarios

### Enhanced Security

#### 3. Admin API Key Cryptographic Hashing
- **Location**: `src/middleware/auth.ts`
- **Current State**: Simple string comparison for admin key
- **Required**: Use bcrypt or similar for admin key validation
- **Details**:
  - Hash admin key on server startup
  - Compare hashed values for authentication
  - Consider rotating admin keys periodically

#### 4. Audit Logging
- **Current State**: No audit trail for sensitive operations
- **Required**: Implement comprehensive audit logging
- **Details**:
  - Log all transfer operations (debit, credit, reversals)
  - Log admin operations (orchestrator registration, BSIM configuration)
  - Log enrollment and revocation events
  - Store audit logs with timestamp, user, action, IP address
  - Consider separate audit database or log aggregation service

### Performance & Scalability

#### 5. Redis Job Queue for Async Processing
- **Location**: `src/routes/transfers.ts` (inline promises)
- **Current State**: Transfer processing happens inline during request
- **Required**: Move transfer execution to async job queue
- **Details**:
  - Integrate Bull or BullMQ with Redis
  - Create job queue for transfer processing
  - Separate API request (PENDING status) from execution (background job)
  - Implement retry logic for failed transfers
  - Monitor queue health and processing times
  - **BSIM Team**: May need Redis instance provisioning

#### 6. Transfer History Pagination Optimization
- **Location**: `src/routes/transfers.ts`, `src/routes/micro-merchants.ts`
- **Current State**: Basic offset-based pagination
- **Required**: Optimize for large result sets
- **Details**:
  - Consider cursor-based pagination for better performance
  - Add database indexes on commonly queried fields
  - Implement caching for frequent queries
  - Add filters (date range, amount range, status)

### Integration & Notifications

#### 7. Webhook Notifications
- **Current State**: No event notifications to orchestrators
- **Required**: Implement webhook system for transfer events
- **Details**:
  - Add webhook URL configuration to Orchestrator model
  - Trigger webhooks for transfer status changes (COMPLETED, FAILED, REVERSED)
  - Implement retry logic for failed webhook deliveries
  - Add webhook signature for security (HMAC-SHA256)
  - Create webhook event log for debugging

#### 8. Enhanced Rate Limiting
- **Location**: `src/app.ts` (global 100 req/15min)
- **Current State**: Basic global rate limiting
- **Required**: Granular rate limiting per endpoint/user
- **Details**:
  - Different limits for different endpoint types
  - Per-user rate limits (not just per-IP)
  - Per-orchestrator rate limits
  - Separate limits for read vs write operations
  - Consider Redis-backed rate limiting for distributed systems

## Phase 3 - Advanced Features

### 9. Hybrid Enrollment Flow with BSIM Consent Screens
- **Current State**: Direct enrollment via TransferSim API
- **Required**: Integrate with BSIM consent UI for better UX
- **Details**:
  - Coordinate with BSIM team on consent screen design
  - Implement OAuth-style consent flow
  - Allow users to grant/revoke granular permissions
  - Support consent expiration and renewal
  - Show users which orchestrators have access

### 10. Enhanced Alias Verification
- **Location**: `src/routes/aliases.ts:170` (accepts hardcoded "123456")
- **Current State**: Development verification code
- **Required**: Production-ready verification
- **Details**:
  - Generate random verification codes
  - Send actual emails via SendGrid/SES
  - Send SMS via Twilio/SNS
  - Implement code expiration (5-10 minutes)
  - Rate limit verification attempts
  - **BSIM Team**: May need email/SMS service provisioning

## Future Enhancements

### 11. Multi-Currency Support
- Add currency field to transfers and accounts
- Implement exchange rate lookup
- Support cross-currency transfers

### 12. Transfer Limits and Fraud Detection
- Daily/weekly transfer limits per user
- Velocity checks (number of transfers in time period)
- Anomaly detection for unusual transfer patterns
- Integration with fraud detection services

### 13. Scheduled Transfers
- Allow users to schedule future-dated transfers
- Recurring transfer support (weekly, monthly)
- Background job to execute scheduled transfers

### 14. Transfer Splits
- Split single transfer to multiple recipients
- Useful for bill splitting, group payments
- Atomic execution (all or nothing)

## Completed Features

- ✅ Core P2P transfer engine (same-bank and cross-bank)
- ✅ Alias management (EMAIL, PHONE, USERNAME, RANDOM_KEY)
- ✅ QR/NFC token support for device-to-device transfers
- ✅ User enrollment and orchestrator management
- ✅ Micro merchant support with fee calculation
- ✅ Merchant dashboard and transaction history
- ✅ Admin APIs for orchestrator and BSIM management
- ✅ Transfer cancellation for pending transfers
- ✅ Basic rate limiting and security headers

# TransferSim Development Guidelines

This document provides context for AI assistants and developers working on TransferSim.

## Project Overview

TransferSim is the P2P Transfer Network for the BSIM ecosystem. It enables:
- Peer-to-peer transfers between users at different banks (BSIM instances)
- Micro Merchant payments with fee tracking
- QR/NFC token generation for device-to-device transfers
- Alias-based recipient resolution (email, phone, username)

## Architecture

```
mwsim (mobile) → TransferSim → BSIM (sender bank)
                            → BSIM (recipient bank)
                            → WSIM (webhooks for push notifications)
```

### Key Services

- **TransferSim** - This service. P2P transfer orchestration.
- **BSIM** - Bank Simulator. Handles accounts, transactions, KYC.
- **WSIM** - Wallet Simulator. User profiles, push notifications, mobile auth.
- **mwsim** - Mobile Wallet app. React Native client.

## Development Commands

```bash
npm run dev          # Start development server with hot reload
npm test             # Run Jest tests
npm run lint         # ESLint check
npx tsc --noEmit     # TypeScript type check
npx prisma generate  # Regenerate Prisma client after schema changes
npx prisma studio    # Database GUI
```

## API Documentation

**IMPORTANT: Keep API specs updated when making changes!**

| File | Format | Purpose |
|------|--------|---------|
| `docs/openapi.yaml` | OpenAPI 3.1 | REST API endpoints |
| `docs/asyncapi.yaml` | AsyncAPI 3.0 | Webhook events |
| `docs/webhook-spec.md` | Markdown | Webhook integration guide |

### When to Update Specs

Update the relevant spec file when you:
- Add or remove an API endpoint
- Change request/response schemas
- Add or modify query parameters
- Change webhook payload structure
- Add new fields to responses

### Versioning

- Bump `info.version` in spec files when making breaking changes
- Update CHANGELOG.md with all API changes
- Version format: `major.minor.patch` (semver)

## Database

- **ORM**: Prisma
- **Database**: PostgreSQL
- **Schema**: `prisma/schema.prisma`

After schema changes:
```bash
npx prisma generate                    # Regenerate client
npx prisma migrate dev --name <name>   # Create migration (dev)
npx prisma migrate deploy              # Apply migrations (prod)
```

## Environment Variables

Key configuration (see `.env.example` for full list):

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `WSIM_WEBHOOK_URL` | WSIM endpoint for transfer notifications |
| `WSIM_WEBHOOK_SECRET` | HMAC signing secret for webhooks |
| `WSIM_INTERNAL_API_URL` | WSIM internal API for profile lookups |
| `WSIM_INTERNAL_API_KEY` | Shared secret for internal API |

## Code Patterns

### Transfer Flow

1. **Initiate** - Validate request, create PENDING transfer
2. **Resolve** - Look up recipient by alias
3. **Debit** - Call sender's BSIM to debit account
4. **Credit** - Call recipient's BSIM to credit account
5. **Complete** - Update status, fetch profile images, send webhook

### Profile Images

Profile images are fetched from WSIM at transfer completion and stored on the Transfer record:
- `senderProfileImageUrl` - For recipient's transaction history
- `recipientProfileImageUrl` - For sender's transaction history

This "store at transfer time" approach (Option A) provides fast queries without runtime lookups.

### Merchant Transactions

Merchant transaction responses include sender details for reconciliation:
- `senderBsimId` - Bank identifier
- `senderBankName` - Display name (looked up from BsimConnection)
- `senderAccountLast4` - Last 4 digits of account
- `senderProfileImageUrl` - Avatar for UI

## Testing

- Unit tests: `src/**/*.test.ts`
- Run with: `npm test`
- Coverage: `npm run test:coverage`

## Deployment

- **Dev**: Buildkite pipeline → Docker on local server
- **Prod**: Buildkite pipeline → AWS ECS

Dev URL: https://transfersim-dev.banksim.ca
Prod URL: https://transfer.banksim.ca

## Related Documentation

- [USER_PROFILE_PROPOSAL.md](../mwsim/LOCAL_DEPLOYMENT_PLANS/USER_PROFILE_PROPOSAL.md) - Profile image feature design
- [CHANGELOG.md](./CHANGELOG.md) - Version history

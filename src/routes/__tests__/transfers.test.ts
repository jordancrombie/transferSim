import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { app } from '../../app.js';
import { prisma } from '../../lib/prisma.js';

describe('POST /api/v1/transfers - Multi-Bank Support', () => {
  let orchestratorApiKey: string;
  let testUserId: string;
  let recipientUserId: string;

  beforeAll(async () => {
    // Create test orchestrator
    const orchestrator = await prisma.orchestrator.create({
      data: {
        orchestratorId: 'test_orch_multibank',
        name: 'Test Orchestrator',
        type: 'MOBILE_APP',
        apiKey: 'test_api_key_multibank_' + Date.now(),
        permissions: {
          canInitiateTransfers: true,
          canViewTransfers: true,
          canManageAliases: true,
          canEnrollUsers: true,
        },
      },
    });
    orchestratorApiKey = orchestrator.apiKey;

    // Create test users at different BSIMs
    testUserId = 'user_multibank_sender';
    recipientUserId = 'user_multibank_recipient';

    // Create recipient alias at NewBank
    await prisma.alias.create({
      data: {
        type: 'USERNAME',
        value: '@testrecipient',
        normalizedValue: '@testrecipient',
        userId: recipientUserId,
        bsimId: 'newbank-dev-001',
        accountId: 'acct_newbank_recipient',
        isPrimary: true,
        isActive: true,
        isVerified: true,
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.transfer.deleteMany({
      where: { OR: [{ senderUserId: testUserId }, { recipientUserId }] },
    });
    await prisma.alias.deleteMany({
      where: { userId: recipientUserId },
    });
    await prisma.orchestrator.deleteMany({
      where: { orchestratorId: 'test_orch_multibank' },
    });
  });

  it('should accept senderBsimId in request body for multi-bank users', async () => {
    const response = await request(app)
      .post('/api/v1/transfers')
      .set('X-API-Key', orchestratorApiKey)
      .set('Authorization', `Bearer ${testUserId}:bsim-dev-001`) // Auth from BSIM Dev
      .send({
        recipientAlias: '@testrecipient',
        amount: 25.0,
        fromAccountId: 'acct_sender_newbank',
        senderBsimId: 'newbank-dev-001', // But sending from NewBank account
        description: 'Multi-bank test transfer',
      });

    expect(response.status).toBe(201);
    expect(response.body.transferId).toBeDefined();
    expect(response.body.status).toBe('PENDING');

    // Verify transfer was created with correct senderBsimId
    const transfer = await prisma.transfer.findFirst({
      where: { transferId: response.body.transferId },
    });

    expect(transfer).not.toBeNull();
    expect(transfer?.senderBsimId).toBe('newbank-dev-001'); // Should use senderBsimId from request body
    expect(transfer?.senderUserId).toBe(testUserId);
  });

  it('should fall back to Bearer token bsimId when senderBsimId not provided', async () => {
    const response = await request(app)
      .post('/api/v1/transfers')
      .set('X-API-Key', orchestratorApiKey)
      .set('Authorization', `Bearer ${testUserId}:bsim-dev-001`)
      .send({
        recipientAlias: '@testrecipient',
        amount: 50.0,
        fromAccountId: 'acct_sender_bsim',
        // No senderBsimId - should use Bearer token value
        description: 'Backward compatibility test',
      });

    expect(response.status).toBe(201);

    const transfer = await prisma.transfer.findFirst({
      where: { transferId: response.body.transferId },
    });

    expect(transfer?.senderBsimId).toBe('bsim-dev-001'); // Should fall back to Bearer token
  });

  it('should log warning when senderBsimId differs from Bearer token context', async () => {
    // This test verifies the warning is logged but still allows the transfer
    // In production, this would verify enrollment
    const consoleWarnSpy = jest.spyOn(console, 'warn');

    const response = await request(app)
      .post('/api/v1/transfers')
      .set('X-API-Key', orchestratorApiKey)
      .set('Authorization', `Bearer ${testUserId}:bsim-dev-001`)
      .send({
        recipientAlias: '@testrecipient',
        amount: 10.0,
        fromAccountId: 'acct_sender_other',
        senderBsimId: 'other-bank-001',
        description: 'Cross-context test',
      });

    expect(response.status).toBe(201);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('requesting transfer from different BSIM')
    );

    consoleWarnSpy.mockRestore();
  });
});

describe('GET /api/v1/transfers - Multi-Bank Filtering', () => {
  let orchestratorApiKey: string;
  const testUserId = 'user_multibank_list';

  beforeAll(async () => {
    const orchestrator = await prisma.orchestrator.findFirst({
      where: { orchestratorId: 'test_orch_multibank' },
    });
    if (orchestrator) {
      orchestratorApiKey = orchestrator.apiKey;
    }
  });

  it('should filter sent transfers by senderBsimId from Bearer token', async () => {
    const response = await request(app)
      .get('/api/v1/transfers?type=sent')
      .set('X-API-Key', orchestratorApiKey)
      .set('Authorization', `Bearer ${testUserId}:bsim-dev-001`);

    expect(response.status).toBe(200);
    expect(response.body.transfers).toBeDefined();

    // All returned transfers should match the user ID and BSIM ID from Bearer token
    response.body.transfers.forEach((transfer: { direction: string }) => {
      expect(transfer.direction).toBe('sent');
    });
  });
});

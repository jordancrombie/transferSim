import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { generateTokenId } from '../utils/id.js';
import { config } from '../config/index.js';
import { BsimClient } from '../services/bsimClient.js';

export const tokenRoutes = Router();

// Validation schemas
const createReceiveTokenSchema = z.object({
  aliasId: z.string().optional(),
  amount: z.number().positive().optional(),
  currency: z.string().default('CAD'),
  description: z.string().max(200).optional(),
  asMerchant: z.boolean().optional().default(false), // Create token as Micro Merchant
});

const createSendTokenSchema = z.object({
  recipientAlias: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().default('CAD'),
  description: z.string().max(200).optional(),
  fromAccountId: z.string(),
});

// POST /api/v1/tokens/receive - Generate receive token (for QR code)
tokenRoutes.post('/receive', requireAuth, async (req: Request, res: Response) => {
  // Debug: Log incoming token creation request
  console.log(`[Token] POST /api/v1/tokens/receive - Incoming request`);
  console.log(`[Token] Request body:`, JSON.stringify(req.body, null, 2));
  console.log(`[Token] User context: userId=${req.user?.userId}, bsimId=${req.user?.bsimId}`);

  try {
    const body = createReceiveTokenSchema.parse(req.body);
    const user = req.user!;

    // If aliasId provided, verify it belongs to user
    if (body.aliasId) {
      const alias = await prisma.alias.findFirst({
        where: {
          id: body.aliasId,
          userId: user.userId,
          bsimId: user.bsimId,
          isActive: true,
        },
      });

      if (!alias) {
        res.status(404).json({
          error: 'Not Found',
          message: 'Alias not found',
        });
        return;
      }
    }

    // If creating as merchant, verify user is a registered Micro Merchant
    let merchant = null;
    if (body.asMerchant) {
      merchant = await prisma.microMerchant.findUnique({
        where: {
          userId_bsimId: {
            userId: user.userId,
            bsimId: user.bsimId,
          },
        },
      });

      if (!merchant || !merchant.isActive) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'User is not registered as an active Micro Merchant',
        });
        return;
      }
    }

    const expiresAt = new Date(Date.now() + config.tokenExpirySeconds * 1000);

    const token = await prisma.token.create({
      data: {
        tokenId: generateTokenId(),
        type: 'RECEIVE',
        aliasId: body.aliasId,
        userId: user.userId,
        bsimId: user.bsimId,
        amount: body.amount ? new Decimal(body.amount) : null,
        currency: body.currency,
        description: body.description,
        recipientType: body.asMerchant ? 'MICRO_MERCHANT' : 'INDIVIDUAL',
        microMerchantId: merchant?.merchantId,
        expiresAt,
      },
    });

    // Build Universal Link URL for QR code
    // This allows any camera app to open mwsim directly via Universal Links
    const qrPayload = `${config.universalLinkBaseUrl}/pay/${token.tokenId}`;

    // Build legacy QR payload for backward compatibility with existing mwsim versions
    const qrPayloadLegacy: Record<string, unknown> = {
      v: 1,                              // Version
      t: 'tsim',                         // Type: TransferSim
      id: token.tokenId,                 // Token ID
      rt: token.recipientType,           // Recipient type
    };
    if (token.amount) qrPayloadLegacy.a = token.amount.toString();
    if (token.currency !== 'CAD') qrPayloadLegacy.c = token.currency;
    if (merchant) {
      qrPayloadLegacy.mn = merchant.merchantName;
      qrPayloadLegacy.mc = merchant.merchantCategory;
    }

    const response = {
      tokenId: token.tokenId,
      type: token.type,
      recipientType: token.recipientType,
      amount: token.amount?.toString(),
      currency: token.currency,
      description: token.description,
      expiresAt: token.expiresAt,
      ...(merchant && {
        merchant: {
          merchantId: merchant.merchantId,
          merchantName: merchant.merchantName,
          merchantCategory: merchant.merchantCategory,
        },
      }),
      // Universal Link URL - use this for QR code display
      qrPayload: qrPayload,
      // Legacy JSON format - for backward compatibility during transition
      qrPayloadLegacy: JSON.stringify(qrPayloadLegacy),
    };

    // Debug: Log token creation response
    console.log(`[Token] Created token ${token.tokenId}, recipientType=${token.recipientType}, asMerchant=${body.asMerchant}`);
    console.log(`[Token] Response:`, JSON.stringify(response, null, 2));

    res.status(201).json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid request body',
        details: error.errors,
      });
      return;
    }
    console.error('Create receive token error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create token',
    });
  }
});

// POST /api/v1/tokens/send - Generate pre-authorized send token
tokenRoutes.post('/send', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = createSendTokenSchema.parse(req.body);
    const user = req.user!;

    // Validate amount against limits
    if (body.amount > config.limits.defaultTransferLimit) {
      res.status(400).json({
        error: 'Bad Request',
        message: `Amount exceeds per-transfer limit of ${config.limits.defaultTransferLimit}`,
      });
      return;
    }

    const expiresAt = new Date(Date.now() + config.tokenExpirySeconds * 1000);

    const token = await prisma.token.create({
      data: {
        tokenId: generateTokenId(),
        type: 'SEND',
        userId: user.userId,
        bsimId: user.bsimId,
        amount: new Decimal(body.amount),
        currency: body.currency,
        description: body.description,
        expiresAt,
      },
    });

    res.status(201).json({
      tokenId: token.tokenId,
      type: token.type,
      amount: token.amount?.toString(),
      currency: token.currency,
      description: token.description,
      expiresAt: token.expiresAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid request body',
        details: error.errors,
      });
      return;
    }
    console.error('Create send token error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create token',
    });
  }
});

// GET /api/v1/tokens/:tokenId - Resolve token
tokenRoutes.get('/:tokenId', requireAuth, async (req: Request, res: Response) => {
  const { tokenId } = req.params;

  // Debug: Log token resolution request
  console.log(`[Token] GET /api/v1/tokens/${tokenId} - Resolving token`);
  console.log(`[Token] User context: userId=${req.user?.userId}, bsimId=${req.user?.bsimId}`);

  try {
    const token = await prisma.token.findUnique({
      where: { tokenId },
    });

    if (!token) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Token not found',
      });
      return;
    }

    // Check if expired
    if (token.expiresAt < new Date()) {
      res.status(410).json({
        error: 'Gone',
        message: 'Token has expired',
      });
      return;
    }

    // Check if already used
    if (token.isUsed) {
      res.status(410).json({
        error: 'Gone',
        message: 'Token has already been used',
      });
      return;
    }

    // Get alias info - first try the specific aliasId, otherwise get primary alias
    let aliasInfo = null;
    let recipientAlias: string | null = null;

    if (token.aliasId) {
      // Use the specific alias attached to the token
      const alias = await prisma.alias.findUnique({
        where: { id: token.aliasId },
      });
      if (alias) {
        aliasInfo = {
          type: alias.type,
          value: alias.value,
        };
        recipientAlias = alias.value;
      }
    }

    // If no alias from token, look up recipient's primary alias
    if (!recipientAlias && token.userId && token.bsimId) {
      const primaryAlias = await prisma.alias.findFirst({
        where: {
          userId: token.userId,
          bsimId: token.bsimId,
          isActive: true,
          isPrimary: true,
        },
      });
      if (primaryAlias) {
        recipientAlias = primaryAlias.value;
        // Also populate aliasInfo if not already set
        if (!aliasInfo) {
          aliasInfo = {
            type: primaryAlias.type,
            value: primaryAlias.value,
          };
        }
      } else {
        // Fall back to any active alias
        const anyAlias = await prisma.alias.findFirst({
          where: {
            userId: token.userId,
            bsimId: token.bsimId,
            isActive: true,
          },
        });
        if (anyAlias) {
          recipientAlias = anyAlias.value;
          if (!aliasInfo) {
            aliasInfo = {
              type: anyAlias.type,
              value: anyAlias.value,
            };
          }
        }
      }
    }

    // Get merchant info if this is a Micro Merchant token
    let merchantInfo = null;
    if (token.recipientType === 'MICRO_MERCHANT' && token.microMerchantId) {
      const merchant = await prisma.microMerchant.findUnique({
        where: { merchantId: token.microMerchantId },
      });
      if (merchant && merchant.isActive) {
        merchantInfo = {
          merchantId: merchant.merchantId,
          merchantName: merchant.merchantName,
          merchantCategory: merchant.merchantCategory,
        };
      }
    }

    // Map recipientType to mwsim-expected format
    // MICRO_MERCHANT -> "merchant", INDIVIDUAL -> "individual"
    const recipientTypeForClient = token.recipientType === 'MICRO_MERCHANT' ? 'merchant' : 'individual';

    // Fetch recipient's display name from BSIM
    let recipientDisplayName = 'Unknown';
    if (token.userId && token.bsimId) {
      const bsimClient = await BsimClient.forBsim(token.bsimId);
      if (bsimClient) {
        const verifyResult = await bsimClient.verifyUser({ userId: token.userId });
        if (verifyResult.exists && verifyResult.displayName) {
          recipientDisplayName = verifyResult.displayName;
        }
      }
    }

    // Fetch recipient's bank name from BSIM connection
    let recipientBankName = 'Unknown Bank';
    if (token.bsimId) {
      const bsimConnection = await prisma.bsimConnection.findUnique({
        where: { bsimId: token.bsimId },
      });
      if (bsimConnection?.name) {
        recipientBankName = bsimConnection.name;
      }
    }

    // Debug: Log token data and mapping
    console.log(`[Token] Token found: type=${token.type}, recipientType=${token.recipientType}, microMerchantId=${token.microMerchantId}`);
    console.log(`[Token] recipientType mapping: ${token.recipientType} -> ${recipientTypeForClient}`);
    console.log(`[Token] Merchant info:`, merchantInfo ? JSON.stringify(merchantInfo) : 'null');
    console.log(`[Token] recipientDisplayName=${recipientDisplayName}, recipientBankName=${recipientBankName}`);

    const response = {
      tokenId: token.tokenId,
      type: token.type,
      recipientType: recipientTypeForClient,  // "merchant" or "individual"
      recipientAlias: recipientAlias,  // For mwsim to call POST /api/v1/transfers
      recipientAliasType: aliasInfo?.type || null,  // EMAIL, PHONE, USERNAME, RANDOM_KEY
      recipientBsimId: token.bsimId,   // Recipient's bank ID
      recipientDisplayName,  // User's display name from BSIM
      recipientBankName,     // Bank name from BSIM connection
      // Merchant-specific fields at top level for mwsim
      ...(merchantInfo && {
        merchantName: merchantInfo.merchantName,
        merchantCategory: merchantInfo.merchantCategory,
      }),
      amount: token.amount?.toString(),
      currency: token.currency,
      description: token.description,
      alias: aliasInfo,
      merchant: merchantInfo,  // Keep nested object for backward compatibility
      expiresAt: token.expiresAt,
    };

    // Debug: Log full response
    console.log(`[Token] Resolution response:`, JSON.stringify(response, null, 2));

    res.json(response);
  } catch (error) {
    console.error('Resolve token error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to resolve token',
    });
  }
});

// POST /api/v1/tokens/:tokenId/use - Mark token as used (called after transfer)
tokenRoutes.post('/:tokenId/use', requireAuth, async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const user = req.user!;

    const token = await prisma.token.findUnique({
      where: { tokenId },
    });

    if (!token) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Token not found',
      });
      return;
    }

    if (token.isUsed) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Token already used',
      });
      return;
    }

    if (token.expiresAt < new Date()) {
      res.status(410).json({
        error: 'Gone',
        message: 'Token has expired',
      });
      return;
    }

    await prisma.token.update({
      where: { tokenId },
      data: {
        isUsed: true,
        usedAt: new Date(),
        usedByUserId: user.userId,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Use token error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to use token',
    });
  }
});

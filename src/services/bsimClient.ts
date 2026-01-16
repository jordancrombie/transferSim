import { prisma } from '../lib/prisma.js';

interface BsimDebitRequest {
  userId: string;
  accountId: string;
  amount: number;
  currency: string;
  transferId: string;
  description?: string;
}

interface BsimCreditRequest {
  userId: string;
  accountId?: string;
  amount: number;
  currency: string;
  transferId: string;
  description?: string;
}

interface BsimVerifyUserRequest {
  userId: string;
}

interface BsimTransactionResponse {
  success: boolean;
  transactionId?: string;
  error?: string;
  message?: string;
}

interface BsimVerifyUserResponse {
  exists: boolean;
  userId?: string;
  displayName?: string;
  error?: string;
}

interface BsimEscrowReleaseRequest {
  escrowId: string;
  contractId: string;         // REQUIRED by BSIM
  transferId: string;
  reason?: string;            // REQUIRED by BSIM (defaults to 'Contract Settlement')
}

export class BsimClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;
  }

  /**
   * Create a BsimClient for a specific BSIM instance
   */
  static async forBsim(bsimId: string): Promise<BsimClient | null> {
    const connection = await prisma.bsimConnection.findUnique({
      where: { bsimId, isActive: true },
    });

    if (!connection) {
      console.error(`No active BSIM connection found for bsimId: ${bsimId}`);
      return null;
    }

    return new BsimClient(connection.baseUrl, connection.apiKey);
  }

  /**
   * Debit (withdraw) from sender's account
   */
  async debit(request: BsimDebitRequest): Promise<BsimTransactionResponse> {
    const url = `${this.baseUrl}/api/p2p/transfer/debit`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify({
          userId: request.userId,
          accountId: request.accountId,
          amount: request.amount,
          currency: request.currency,
          transferId: request.transferId,
          description: request.description || 'P2P Transfer',
        }),
      });

      const data = await response.json() as { transactionId?: string; error?: string; message?: string };

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Debit failed',
          message: data.message || `HTTP ${response.status}`,
        };
      }

      return {
        success: true,
        transactionId: data.transactionId,
      };
    } catch (error) {
      console.error('BSIM debit error:', error);
      return {
        success: false,
        error: 'Connection failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Credit (deposit) to recipient's account
   */
  async credit(request: BsimCreditRequest): Promise<BsimTransactionResponse> {
    const url = `${this.baseUrl}/api/p2p/transfer/credit`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify({
          userId: request.userId,
          accountId: request.accountId,
          amount: request.amount,
          currency: request.currency,
          transferId: request.transferId,
          description: request.description || 'P2P Transfer',
        }),
      });

      const data = await response.json() as { transactionId?: string; error?: string; message?: string };

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Credit failed',
          message: data.message || `HTTP ${response.status}`,
        };
      }

      return {
        success: true,
        transactionId: data.transactionId,
      };
    } catch (error) {
      console.error('BSIM credit error:', error);
      return {
        success: false,
        error: 'Connection failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Verify a user exists at this BSIM
   */
  async verifyUser(request: BsimVerifyUserRequest): Promise<BsimVerifyUserResponse> {
    const url = `${this.baseUrl}/api/p2p/user/verify`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify({
          userId: request.userId,
        }),
      });

      const data = await response.json() as { exists?: boolean; userId?: string; displayName?: string; error?: string; message?: string };

      if (!response.ok) {
        return {
          exists: false,
          error: data.error || data.message || `HTTP ${response.status}`,
        };
      }

      return {
        exists: data.exists ?? true,
        userId: data.userId,
        displayName: data.displayName,
      };
    } catch (error) {
      console.error('BSIM verify user error:', error);
      return {
        exists: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Release funds from escrow (deduct from loser's escrowed account)
   * Used for ContractSim settlements where funds were pre-escrowed.
   * NOTE: This only releases/deducts - TransferSim must separately call credit() to pay the winner.
   */
  async escrowRelease(request: BsimEscrowReleaseRequest): Promise<BsimTransactionResponse> {
    const url = `${this.baseUrl}/api/escrow/${encodeURIComponent(request.escrowId)}/release`;

    console.log(`[BsimClient] Releasing escrow ${request.escrowId} for contract ${request.contractId}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify({
          contract_id: request.contractId,
          reason: request.reason || 'Contract Settlement',
          transfer_reference: request.transferId,
        }),
      });

      const data = await response.json() as { transactionId?: string; transaction_id?: string; error?: string; message?: string };

      if (!response.ok) {
        console.error(`[BsimClient] Escrow release failed: ${data.error || data.message}`);
        return {
          success: false,
          error: data.error || 'Escrow release failed',
          message: data.message || `HTTP ${response.status}`,
        };
      }

      const transactionId = data.transactionId || data.transaction_id;
      console.log(`[BsimClient] Escrow released successfully, transactionId=${transactionId}`);
      return {
        success: true,
        transactionId,
      };
    } catch (error) {
      console.error('BSIM escrow release error:', error);
      return {
        success: false,
        error: 'Connection failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

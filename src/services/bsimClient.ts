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
}

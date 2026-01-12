import { config } from '../config/index.js';

interface WsimProfileResponse {
  profileImageUrl?: string;
  error?: string;
}

/**
 * Client for WSIM internal APIs
 * Used for fetching user profile data (e.g., profile images)
 */
export class WsimClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;
  }

  /**
   * Create a WsimClient using configured credentials
   * Returns null if WSIM internal API is not configured
   */
  static create(): WsimClient | null {
    if (!config.wsim.internalApiUrl || !config.wsim.internalApiKey) {
      console.warn('[WsimClient] WSIM internal API not configured');
      return null;
    }

    return new WsimClient(config.wsim.internalApiUrl, config.wsim.internalApiKey);
  }

  /**
   * Fetch user profile data from WSIM
   * @param bsimUserId - The user's ID at their BSIM (fiUserRef)
   * @param bsimId - The BSIM instance ID
   */
  async getProfile(bsimUserId: string, bsimId: string): Promise<WsimProfileResponse> {
    const url = `${this.baseUrl}/api/internal/profile?bsimUserId=${encodeURIComponent(bsimUserId)}&bsimId=${encodeURIComponent(bsimId)}`;

    console.log(`[WsimClient] Fetching profile for bsimUserId=${bsimUserId}, bsimId=${bsimId}`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Internal-Api-Key': this.apiKey,
        },
      });

      if (response.status === 404) {
        // User not found or no profile - this is OK, return empty
        console.log(`[WsimClient] No profile found for bsimUserId=${bsimUserId}`);
        return {};
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[WsimClient] Profile fetch failed: HTTP ${response.status} - ${errorText}`);
        return {
          error: `HTTP ${response.status}`,
        };
      }

      const data = await response.json() as { success?: boolean; profile?: { profileImageUrl?: string } };
      console.log(`[WsimClient] Profile fetched: profileImageUrl=${data.profile?.profileImageUrl ? 'present' : 'absent'}`);

      return {
        profileImageUrl: data.profile?.profileImageUrl,
      };
    } catch (error) {
      console.error('[WsimClient] Profile fetch error:', error);
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

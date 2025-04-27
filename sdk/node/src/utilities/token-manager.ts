import { AuthenticationError, HPKVError } from '../websocket/errors';
import { HPKVTokenConfig } from '../websocket';

/**
 * WebsocketTokenManager
 *
 * Manages authentication tokens for WebSocket connections.
 * Handles token generation and API authentication.
 */
export class WebsocketTokenManager {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    if (!apiKey) {
      throw new AuthenticationError('API key is required to generate a token');
    }
    if (!baseUrl) {
      throw new HPKVError('Base URL is required to generate a token');
    }

    this.apiKey = apiKey;
    // Convert WebSocket URLs to HTTP URLs and remove /ws suffix for REST API calls
    this.baseUrl = baseUrl.replace(/^wss?:\/\//, 'https://').replace(/\/ws$/, '');
  }

  /**
   * Generates an authentication token for WebSocket connections
   *
   * @param config - Configuration for the token including subscribed keys and permissions
   * @returns A Promise that resolves to the generated token string
   * @throws {AuthenticationError} If authentication fails
   * @throws {HPKVError} If token generation fails for other reasons
   */
  async generateToken(config: HPKVTokenConfig): Promise<string> {
    const response = await fetch(`${this.baseUrl}/token/websocket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AuthenticationError(`Failed to generate token: ${response.statusText}`);
      }
      throw new HPKVError(`Failed to generate token: ${response.statusText}`);
    }

    const data = await response.json();
    return data.token;
  }
}

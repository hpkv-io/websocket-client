import { AuthenticationError, HPKVError } from '../websocket/errors';
import { HPKVTokenConfig } from '../websocket';
import fetch from 'cross-fetch';

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
    try {
      const response = await fetch(`${this.baseUrl}/token/websocket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const status = response.status;
        const statusText = response.statusText || 'Unknown error';
        if (status === 401 || status === 403) {
          throw new AuthenticationError(`Failed to generate token: ${status} ${statusText}`);
        }
        throw new HPKVError(`Failed to generate token: ${status} ${statusText}`);
      }

      const data = (await response.json()) as { token: string };
      return data.token;
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof HPKVError) {
        throw error;
      }

      // Handle network errors or JSON parsing errors
      if (error instanceof TypeError) {
        throw new HPKVError('Failed to generate token: No response from server');
      }

      throw new HPKVError(
        `Failed to generate token: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

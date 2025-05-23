import { AuthenticationError, HPKVError } from '../websocket/errors';
import { HPKVTokenConfig } from '../websocket';
import axios, { AxiosError } from 'axios';

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
      const response = await axios.post<{ token: string }>(
        `${this.baseUrl}/token/websocket`,
        config,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
          },
        }
      );
      return response.data.token;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response) {
          const status = axiosError.response.status;
          const statusText = axiosError.response.statusText || 'Unknown error';
          if (status === 401 || status === 403) {
            throw new AuthenticationError(`Failed to generate token: ${status} ${statusText}`);
          }
          throw new HPKVError(`Failed to generate token: ${status} ${statusText}`);
        } else if (axiosError.request) {
          throw new HPKVError('Failed to generate token: No response from server');
        } else {
          throw new HPKVError(`Failed to generate token: ${axiosError.message}`);
        }
      }

      throw new HPKVError(
        `Failed to generate token: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

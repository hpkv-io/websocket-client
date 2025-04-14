import { AuthenticationError, HPKVError } from './clients/errors';
import { HPKVTokenConfig } from './types';

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

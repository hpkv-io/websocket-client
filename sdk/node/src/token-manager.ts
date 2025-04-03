import { HPKVTokenConfig } from './types';

export class WebsocketTokenManager {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    if (!apiKey) {
      throw new Error('API key is required to generate a token');
    }
    if (!baseUrl) {
      throw new Error('Base URL is required to generate a token');
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
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
      throw new Error(`Failed to generate token: ${response.statusText}`);
    }

    const data = await response.json();
    return data.token;
  }
}

import { BaseWebSocketClient } from './base-client';

/**
 * Client for performing CRUD operations on the key-value store
 * Uses API key authentication for secure access to the HPKV API
 */
export class HPKVApiClient extends BaseWebSocketClient {
  private readonly apiKey: string;

  /**
   * Creates a new HPKVApiClient instance
   * @param apiKey - The API key to use for authentication
   * @param baseUrl - The base URL of the HPKV API
   */
  constructor(apiKey: string, baseUrl: string) {
    super(baseUrl);
    this.apiKey = apiKey;
  }

  /**
   * Builds the WebSocket connection URL with API key authentication
   * @returns The WebSocket connection URL with the API key as a query parameter
   */
  protected buildConnectionUrl(): string {
    const baseUrl = this.baseUrl.endsWith('/ws') ? this.baseUrl : `${this.baseUrl}/ws`;
    return `${baseUrl}?apiKey=${this.apiKey}`;
  }
}

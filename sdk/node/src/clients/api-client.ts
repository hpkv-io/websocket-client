import { ConnectionConfig } from '../websocket';
import { BaseWebSocketClient } from '../websocket/base-websocket-client';

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
   * @param config - The configuration for the client
   */
  constructor(apiKey: string, baseUrl: string, config?: ConnectionConfig) {
    super(baseUrl, config);
    this.apiKey = apiKey;
  }

  /**
   * Builds the WebSocket connection URL with API key authentication
   * @returns The WebSocket connection URL with the API key as a query parameter
   */
  protected buildConnectionUrl(): string {
    // Base URL already includes /ws from BaseWebSocketClient constructor
    return `${this.baseUrl}?apiKey=${this.apiKey}`;
  }
}

import { BaseWebSocketClient } from './base-client';
import { HPKVResponse, HPKVEventHandler } from '../types';

/**
 * Client for subscribing to real-time updates on key changes
 * This client uses a token for authentication and manages subscriptions
 * to specific keys, invoking callbacks when changes occur.
 */
export class HPKVSubscriptionClient extends BaseWebSocketClient {
  private readonly token: string;
  private subscriptions: Map<string, HPKVEventHandler[]> = new Map();

  /**
   * Creates a new HPKVSubscriptionClient instance
   * @param token - The authentication token to use for WebSocket connections
   * @param baseUrl - The base URL of the HPKV API
   */
  constructor(token: string, baseUrl: string) {
    super(baseUrl);
    this.token = token;
  }

  /**
   * Builds the WebSocket connection URL with token-based authentication
   * @returns The WebSocket connection URL with the token as a query parameter
   */
  protected buildConnectionUrl(): string {
    const baseUrl = this.baseUrl.endsWith('/ws') ? this.baseUrl : `${this.baseUrl}/ws`;
    return `${baseUrl}?token=${this.token}`;
  }

  /**
   * Subscribes to changes for a specific key
   * When changes to the key occur, the provided callback will be invoked
   * with the update data
   *
   * @param key - The key to subscribe to
   * @param callback - Function to be called when the key changes
   */
  subscribe(key: string, callback: HPKVEventHandler): void {
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, []);
    }
    this.subscriptions.get(key)?.push(callback);
  }

  /**
   * Unsubscribes from changes for a specific key
   * Removes all callbacks registered for the specified key
   *
   * @param key - The key to unsubscribe from
   */
  unsubscribe(key: string): void {
    this.subscriptions.delete(key);
  }

  /**
   * Processes WebSocket messages and triggers subscription callbacks
   * Extends the base class implementation to handle subscription events
   *
   * @param message - The message received from the WebSocket server
   */
  protected handleMessage(message: HPKVResponse): void {
    super.handleMessage(message);

    // Handle subscription messages
    if (message.key) {
      const subscribers = this.subscriptions.get(message.key);
      if (subscribers) {
        subscribers.forEach(callback => callback(message));
      }
    }
  }
}

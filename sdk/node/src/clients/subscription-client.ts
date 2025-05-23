import { BaseWebSocketClient } from '../websocket/base-websocket-client';
import {
  HPKVEventHandler,
  ConnectionConfig,
  HPKVNotificationResponse,
  HPKVResponse,
} from '../websocket';

/**
 * Client for subscribing to real-time updates on key changes
 * This client uses a token for authentication and manages subscriptions
 * to specific keys, invoking callbacks when changes occur.
 */
export class HPKVSubscriptionClient extends BaseWebSocketClient {
  private readonly token: string;
  private subscriptions: Map<string, HPKVEventHandler> = new Map();

  /**
   * Creates a new HPKVSubscriptionClient instance
   * @param token - The authentication token to use for WebSocket connections
   * @param baseUrl - The base URL of the HPKV API
   * @param config - The connection configuration
   */
  constructor(token: string, baseUrl: string, config?: ConnectionConfig) {
    super(baseUrl, config);
    this.token = token;
  }

  /**
   * Builds the WebSocket connection URL with token-based authentication
   * @returns The WebSocket connection URL with the token as a query parameter
   */
  protected buildConnectionUrl(): string {
    // Base URL already includes /ws from BaseWebSocketClient constructor
    return `${this.baseUrl}?token=${this.token}`;
  }

  /**
   * Subscribes to changes for subscribedKeys
   * When changes to the key occur, the provided callback will be invoked
   * with the update data
   *
   * @param callback - Function to be called when the key changes
   * @returns The callback ID
   */
  subscribe(callback: HPKVEventHandler): string {
    const callbackId = Math.random().toString(36).substring(2, 15);
    this.subscriptions.set(callbackId, callback);
    return callbackId;
  }

  /**
   * Unsubscribes a callback from the subscription client
   *
   * @param callbackId - The callback ID to unsubscribe
   */
  unsubscribe(callbackId: string): void {
    this.subscriptions.delete(callbackId);
  }

  /**
   * Processes WebSocket messages and triggers subscription callbacks
   * Extends the base class implementation to handle subscription events
   *
   * @param message - The message received from the WebSocket server
   */
  protected handleMessage(message: HPKVResponse): void {
    if (message && 'type' in message && message.type === 'notification') {
      const notification = message as HPKVNotificationResponse;
      if (this.subscriptions.size > 0) {
        this.subscriptions.forEach(callback => {
          Promise.resolve().then(() => {
            callback(notification);
          });
        });
      }
    } else {
      return super.handleMessage(message);
    }
  }
}

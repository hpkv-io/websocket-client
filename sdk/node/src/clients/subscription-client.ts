import { BaseWebSocketClient } from './base-client';
import { HPKVResponse, HPKVEventHandler } from '../types';

export class HPKVSubscriptionClient extends BaseWebSocketClient {
  private readonly token: string;
  private subscriptions: Map<string, HPKVEventHandler[]> = new Map();

  constructor(token: string, baseUrl: string) {
    super(baseUrl);
    this.token = token;
  }

  protected buildConnectionUrl(): string {
    const baseUrl = this.baseUrl.endsWith('/ws') ? this.baseUrl : `${this.baseUrl}/ws`;
    return `${baseUrl}?token=${this.token}`;
  }

  // Subscription Operations
  subscribe(key: string, callback: HPKVEventHandler): void {
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, []);
    }
    this.subscriptions.get(key)?.push(callback);
  }

  unsubscribe(key: string): void {
    this.subscriptions.delete(key);
  }

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

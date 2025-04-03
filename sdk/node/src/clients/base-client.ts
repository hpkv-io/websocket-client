import WebSocket from 'ws';
import { HPKVResponse, HPKVRequestMessage, HPKVOperation } from '../types';

export abstract class BaseWebSocketClient {
  protected ws: WebSocket | null = null;
  protected isConnected = false;
  protected reconnectAttempts = 0;
  protected messageQueue: {
    resolve: (value: HPKVResponse) => void;
    reject: (reason?: unknown) => void;
  }[] = [];
  protected messageId = 0;
  protected connectionTimeout: NodeJS.Timeout | null = null;
  protected isDisconnecting = false;
  protected baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
  }

  protected abstract buildConnectionUrl(): string;

  // CRUD Operations
  async get(key: string): Promise<HPKVResponse> {
    return this.sendMessage({
      op: HPKVOperation.GET,
      key,
    });
  }

  async set(key: string, value: unknown): Promise<HPKVResponse> {
    return this.sendMessage({
      op: HPKVOperation.SET,
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    });
  }

  async delete(key: string): Promise<HPKVResponse> {
    return this.sendMessage({
      op: HPKVOperation.DELETE,
      key,
    });
  }

  async patch(key: string, value: unknown): Promise<HPKVResponse> {
    return this.sendMessage({
      op: HPKVOperation.PATCH,
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    });
  }

  async range(key: string, endKey: string, options: { limit?: number }): Promise<HPKVResponse> {
    return this.sendMessage({
      op: HPKVOperation.RANGE,
      key,
      endKey,
      limit: options.limit,
    });
  }

  async atomicIncrement(key: string, value: number): Promise<HPKVResponse> {
    return this.sendMessage({
      op: HPKVOperation.ATOMIC,
      key,
      value: value.toString(),
    });
  }

  // Connection Management
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        // Set up connection timeout
        this.connectionTimeout = setTimeout(() => {
          if (!this.isConnected) {
            this.cleanup();
            reject(new Error('Connection timeout'));
          }
        }, 10000);

        this.ws = new WebSocket(this.buildConnectionUrl());

        this.ws.on('open', () => {
          this.isConnected = true;
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }
          this.reconnectAttempts = 0;
          resolve();
        });

        this.ws.on('message', (data: string) => {
          const message = JSON.parse(data);
          this.handleMessage(message);
        });

        this.ws.on('close', () => {
          this.isConnected = false;
          this.handleDisconnect();
        });

        this.ws.on('error', error => {
          this.isConnected = false;
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }
          reject(error);
        });
      } catch (error) {
        this.cleanup();
        reject(error);
      }
    });
  }

  disconnect(): void {
    this.isDisconnecting = true;
    this.cleanup();
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  protected cleanup(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  protected handleDisconnect(): void {
    if (this.isDisconnecting) {
      this.isDisconnecting = false;
      return;
    }

    if (this.reconnectAttempts < 5) {
      this.reconnectAttempts++;
      setTimeout(() => {
        this.connect().catch(() => {});
      }, 1000);
    } else {
      this.messageQueue.forEach(({ reject }) => {
        reject(new Error('Connection lost'));
      });
      this.messageQueue = [];
    }
  }

  protected handleMessage(message: HPKVResponse): void {
    // Handle error responses
    if (message.error) {
      const { reject } = this.messageQueue.shift() || {};
      if (reject) {
        reject(new Error(message.error));
      }
      return;
    }

    // Handle successful responses
    if (message.messageId !== undefined) {
      const { resolve } = this.messageQueue.shift() || {};
      if (resolve) {
        resolve(message);
      }
      return;
    }
  }

  protected async sendMessage(
    message: Omit<HPKVRequestMessage, 'messageId'>
  ): Promise<HPKVResponse> {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      const messageWithId: HPKVRequestMessage = {
        ...message,
        messageId: id,
      };

      // Set up message timeout
      const messageTimeout = setTimeout(() => {
        const index = this.messageQueue.findIndex(item => item.resolve === resolve);
        if (index !== -1) {
          this.messageQueue.splice(index, 1);
          reject(new Error('Message timeout'));
        }
      }, 10000);

      this.messageQueue.push({
        resolve: value => {
          clearTimeout(messageTimeout);
          resolve(value);
        },
        reject: error => {
          clearTimeout(messageTimeout);
          reject(error);
        },
      });

      this.ws?.send(JSON.stringify(messageWithId));
    });
  }
}

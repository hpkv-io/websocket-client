import WebSocket from 'ws';
import { HPKVResponse, HPKVRequestMessage, HPKVOperation, RangeQueryOptions } from '../types';

/**
 * Base WebSocket client that handles connection management and message passing
 * for the HPKV WebSocket API.
 */
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

  /**
   * Creates a new BaseWebSocketClient instance
   * @param baseUrl - The base URL of the HPKV API
   */
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
  }

  /**
   * Builds the WebSocket connection URL with authentication
   * @returns The WebSocket connection URL
   */
  protected abstract buildConnectionUrl(): string;

  /**
   * Retrieves a value from the key-value store
   * @param key - The key to retrieve
   * @returns A promise that resolves with the API response
   * @throws Error if the key is not found or connection fails
   */
  async get(key: string): Promise<HPKVResponse> {
    return this.sendMessage({
      op: HPKVOperation.GET,
      key,
    });
  }

  /**
   * Stores a value in the key-value store
   * @param key - The key to store the value under
   * @param value - The value to store (will be stringified if not a string)
   * @param partialUpdate - If true, performs a partial update/patch instead of replacing the entire value
   * @returns A promise that resolves with the API response
   * @throws Error if the operation fails or connection is lost
   */
  async set(key: string, value: unknown, partialUpdate = false): Promise<HPKVResponse> {
    if (partialUpdate) {
      return this.sendMessage({
        op: HPKVOperation.PATCH,
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      });
    }

    return this.sendMessage({
      op: HPKVOperation.SET,
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    });
  }

  /**
   * Deletes a value from the key-value store
   * @param key - The key to delete
   * @returns A promise that resolves with the API response
   * @throws Error if the key is not found or connection fails
   */
  async delete(key: string): Promise<HPKVResponse> {
    return this.sendMessage({
      op: HPKVOperation.DELETE,
      key,
    });
  }

  /**
   * Performs a range query to retrieve multiple keys within a specified range
   * @param key - The start key of the range
   * @param endKey - The end key of the range
   * @param options - Additional options for the range query
   * @returns A promise that resolves with the API response containing matching records
   * @throws Error if the operation fails or connection is lost
   */
  async range(key: string, endKey: string, options?: RangeQueryOptions): Promise<HPKVResponse> {
    return this.sendMessage({
      op: HPKVOperation.RANGE,
      key,
      endKey,
      limit: options?.limit,
    });
  }

  /**
   * Performs an atomic increment operation on a numeric value
   * @param key - The key of the value to increment
   * @param value - The amount to increment by
   * @returns A promise that resolves with the API response
   * @throws Error if the key does not contain a numeric value or connection fails
   */
  async atomicIncrement(key: string, value: number): Promise<HPKVResponse> {
    return this.sendMessage({
      op: HPKVOperation.ATOMIC,
      key,
      value: value.toString(),
    });
  }

  /**
   * Establishes a WebSocket connection to the HPKV API
   * @returns A promise that resolves when the connection is established
   * @throws Error if the connection fails or times out
   */
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

  /**
   * Gracefully closes the WebSocket connection
   */
  disconnect(): void {
    this.isDisconnecting = true;
    this.cleanup();
  }

  /**
   * Returns the current connection status
   * @returns true if connected, false otherwise
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Cleans up resources and closes the WebSocket connection
   */
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

  /**
   * Handles disconnect events and attempts to reconnect
   * Rejects pending messages after max reconnect attempts
   */
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

  /**
   * Processes WebSocket messages and resolves corresponding promises
   * @param message - The message received from the WebSocket server
   */
  protected handleMessage(message: HPKVResponse): void {
    // Skip notification messages
    if (message.type == 'notification') {
      return;
    }

    // Get the next promise from the queue
    const queueItem = this.messageQueue.shift();
    if (!queueItem) {
      return; // No pending promises to resolve
    }

    const { resolve, reject } = queueItem;

    // Handle error responses
    if (message.success === false || message.code !== 200 || message.error) {
      reject(new Error(message.error));
      return;
    }

    // Handle successful responses
    if (message.messageId !== undefined) {
      resolve(message);
      return;
    }
  }

  /**
   * Sends a message to the WebSocket server and handles the response
   * @param message - The message to send
   * @returns A promise that resolves with the server response
   * @throws Error if the message times out or connection fails
   */
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

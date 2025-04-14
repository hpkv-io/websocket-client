import WebSocketNode from 'ws';
import {
  HPKVResponse,
  HPKVRequestMessage,
  HPKVOperation,
  RangeQueryOptions,
  ConnectionStats,
  ConnectionConfig,
} from '../types';
import { ConnectionError, HPKVError, TimeoutError } from './errors';
import { EventEmitter } from 'events';

// Use native WebSocket in browser or ws package in Node.js
const WebSocketImpl: typeof WebSocketNode =
  typeof window !== 'undefined' && window.WebSocket
    ? (window.WebSocket as unknown as typeof WebSocketNode)
    : WebSocketNode;

/**
 * Connection state for WebSocket client
 */
enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  DISCONNECTING = 'DISCONNECTING',
}

/**
 * Interface for a pending request
 */
interface PendingRequest {
  resolve: (value: HPKVResponse) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
  timestamp: number;
  operation: HPKVOperation;
}

/**
 * Configuration for the exponential backoff retry strategy
 */
interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  jitterMs?: number;
}

/**
 * Default timeout values in milliseconds
 */
const DEFAULT_TIMEOUTS = {
  CONNECTION: 30000, // 10 seconds for connection
  OPERATION: 10000, // 10 seconds for operations
  CLEANUP: 60000, // 60 seconds for stale request cleanup
} as const;

/**
 * Base WebSocket client that handles connection management and message passing
 * for the HPKV WebSocket API.
 */
export abstract class BaseWebSocketClient {
  protected ws: WebSocketNode | null = null;
  protected baseUrl: string;
  protected messageId = 0;
  protected connectionPromise: Promise<void> | null = null;
  protected connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  protected reconnectAttempts = 0;
  protected connectionTimeout: NodeJS.Timeout | null = null;
  protected operationTimeoutMs: number | null = null;

  protected cleanupInterval: NodeJS.Timeout | null = null;
  protected emitter = new EventEmitter();
  protected messageMap = new Map<number, PendingRequest>();
  protected requestQueue: Array<() => Promise<unknown>> = [];

  // Retry configuration
  protected retry: RetryConfig;

  // Timeout values
  protected timeouts = { ...DEFAULT_TIMEOUTS };

  /**
   * Creates a new BaseWebSocketClient instance
   * @param baseUrl - The base URL of the HPKV API
   * @param config - The connection configuration
   */
  constructor(baseUrl: string, config?: ConnectionConfig) {
    this.baseUrl = baseUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');

    // Initialize retry configuration
    this.retry = {
      maxAttempts: config?.maxReconnectAttempts || 3,
      initialDelayMs: config?.initialDelayBetweenReconnects || 1000,
      maxDelayMs: config?.maxDelayBetweenReconnects || 30000,
      jitterMs: 500, // Add some randomness to prevent thundering herd
    };

    // Setup automatic cleanup of stale requests
    this.cleanupInterval = setInterval(() => this.cleanupStaleRequests(), this.timeouts.CLEANUP);
  }

  /**
   * Builds the WebSocket connection URL with authentication
   * @returns The WebSocket connection URL
   */
  protected abstract buildConnectionUrl(): string;

  /**
   * Register event listeners
   */
  on(
    event: 'connected' | 'disconnected' | 'reconnecting' | 'reconnectFailed',
    listener: (...args: any[]) => void
  ): void {
    this.emitter.on(event, listener);
  }

  /**
   * Remove event listeners
   */
  off(
    event: 'connected' | 'disconnected' | 'reconnecting' | 'reconnectFailed',
    listener: (...args: any[]) => void
  ): void {
    this.emitter.off(event, listener);
  }

  /**
   * Retrieves a value from the key-value store
   * @param key - The key to retrieve
   * @param timeoutMs - Optional custom timeout for this operation
   * @returns A promise that resolves with the API response
   * @throws Error if the key is not found or connection fails
   */
  async get(key: string, timeoutMs?: number): Promise<HPKVResponse> {
    return this.sendMessage(
      {
        op: HPKVOperation.GET,
        key,
      },
      timeoutMs
    );
  }

  /**
   * Stores a value in the key-value store
   * @param key - The key to store the value under
   * @param value - The value to store (will be stringified if not a string)
   * @param partialUpdate - If true, performs a partial update/patch instead of replacing the entire value
   * @param timeoutMs - Optional custom timeout for this operation
   * @returns A promise that resolves with the API response
   * @throws Error if the operation fails or connection is lost
   */
  async set(
    key: string,
    value: unknown,
    partialUpdate = false,
    timeoutMs?: number
  ): Promise<HPKVResponse> {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

    return this.sendMessage(
      {
        op: partialUpdate ? HPKVOperation.PATCH : HPKVOperation.SET,
        key,
        value: stringValue,
      },
      timeoutMs
    );
  }

  /**
   * Deletes a value from the key-value store
   * @param key - The key to delete
   * @param timeoutMs - Optional custom timeout for this operation
   * @returns A promise that resolves with the API response
   * @throws Error if the key is not found or connection fails
   */
  async delete(key: string, timeoutMs?: number): Promise<HPKVResponse> {
    return this.sendMessage(
      {
        op: HPKVOperation.DELETE,
        key,
      },
      timeoutMs
    );
  }

  /**
   * Performs a range query to retrieve multiple keys within a specified range
   * @param key - The start key of the range
   * @param endKey - The end key of the range
   * @param options - Additional options for the range query
   * @param timeoutMs - Optional custom timeout for this operation
   * @returns A promise that resolves with the API response containing matching records
   * @throws Error if the operation fails or connection is lost
   */
  async range(
    key: string,
    endKey: string,
    options?: RangeQueryOptions,
    timeoutMs?: number
  ): Promise<HPKVResponse> {
    return this.sendMessage(
      {
        op: HPKVOperation.RANGE,
        key,
        endKey,
        limit: options?.limit,
      },
      timeoutMs
    );
  }

  /**
   * Performs an atomic increment operation on a numeric value
   * @param key - The key of the value to increment
   * @param value - The amount to increment by
   * @param timeoutMs - Optional custom timeout for this operation
   * @returns A promise that resolves with the API response
   * @throws Error if the key does not contain a numeric value or connection fails
   */
  async atomicIncrement(key: string, value: number, timeoutMs?: number): Promise<HPKVResponse> {
    return this.sendMessage(
      {
        op: HPKVOperation.ATOMIC,
        key,
        value,
      },
      timeoutMs
    );
  }

  /**
   * Establishes a WebSocket connection to the HPKV API
   * @returns A promise that resolves when the connection is established
   * @throws ConnectionError if the connection fails or times out
   */
  async connect(): Promise<void> {
    // If already connected, resolve immediately
    if (
      this.connectionState === ConnectionState.CONNECTED &&
      this.ws?.readyState === WebSocketNode.OPEN
    ) {
      return;
    }

    // If connection is in progress, return the existing promise
    if (this.connectionState === ConnectionState.CONNECTING && this.connectionPromise) {
      return this.connectionPromise;
    }

    // Start a new connection
    this.connectionState = ConnectionState.CONNECTING;
    this.connectionPromise = new Promise<void>((resolve, reject) => {
      try {
        // Set up connection timeout
        this.connectionTimeout = setTimeout(() => {
          if (this.connectionState !== ConnectionState.CONNECTED) {
            this.cleanup();
            reject(new TimeoutError(`Connection timeout after ${this.timeouts.CONNECTION}ms`));
          }
        }, this.timeouts.CONNECTION);

        this.ws = new WebSocketImpl(this.buildConnectionUrl());

        this.ws!.on('open', () => {
          this.connectionState = ConnectionState.CONNECTED;
          this.emitter.emit('connected');

          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }

          this.reconnectAttempts = 0;
          this.processRequestQueue();
          resolve();
        });

        this.ws!.on('message', (data: string) => {
          const message = JSON.parse(data);
          this.handleMessage(message);
        });

        this.ws!.on('close', (code: number, reason: string) => {
          const wasConnected = this.connectionState === ConnectionState.CONNECTED;
          this.connectionState = ConnectionState.DISCONNECTED;

          if (wasConnected) {
            this.emitter.emit('disconnected', { code, reason });
          }

          this.handleDisconnect(code, reason);
        });

        this.ws!.on('error', error => {
          if (this.connectionState === ConnectionState.CONNECTING) {
            if (this.connectionTimeout) {
              clearTimeout(this.connectionTimeout);
              this.connectionTimeout = null;
            }

            this.connectionState = ConnectionState.DISCONNECTED;
            reject(new ConnectionError(error.message));
          }
        });
      } catch (error) {
        this.cleanup();
        this.connectionState = ConnectionState.DISCONNECTED;
        reject(new ConnectionError(error instanceof Error ? error.message : 'Unknown error'));
      }
    });

    return this.connectionPromise;
  }

  /**
   * Gracefully closes the WebSocket connection
   * @param cancelPendingRequests - Whether to cancel all pending requests (default: true)
   * @returns A promise that resolves when the connection is closed
   */
  async disconnect(cancelPendingRequests = true): Promise<void> {
    if (this.connectionState === ConnectionState.DISCONNECTED) {
      return;
    }

    this.connectionState = ConnectionState.DISCONNECTING;

    if (cancelPendingRequests) {
      this.cancelAllRequests(new ConnectionError('Connection closed by client'));
    }

    return new Promise<void>(resolve => {
      if (!this.ws || this.ws.readyState === WebSocketNode.CLOSED) {
        this.connectionState = ConnectionState.DISCONNECTED;
        resolve();
      }

      this.ws!.removeAllListeners();

      const onClose = (): void => {
        this.connectionState = ConnectionState.DISCONNECTED;
        this.emitter.emit('disconnected');
        resolve();
        return;
      };

      this.ws!.on('close', onClose);
      this.cleanup();
    });
  }

  /**
   * Get the current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get current connection statistics
   */
  getConnectionStats(): ConnectionStats {
    return {
      isConnected: this.connectionState === ConnectionState.CONNECTED,
      reconnectAttempts: this.reconnectAttempts,
      messagesPending: this.messageMap.size,
      connectionState: this.connectionState,
      queueSize: this.requestQueue.length,
    } as ConnectionStats;
  }

  /**
   * Attempts to reconnect to the WebSocket server with exponential backoff
   * @returns A promise that resolves when the connection is reestablished
   * @throws ConnectionError if reconnection fails after max attempts
   */
  protected async reconnect(): Promise<void> {
    if (
      this.connectionState === ConnectionState.DISCONNECTING ||
      this.connectionState === ConnectionState.CONNECTING
    ) {
      return;
    }

    this.reconnectAttempts++;

    // Calculate delay with exponential backoff and jitter
    const baseDelay = Math.min(
      this.retry.initialDelayMs * Math.pow(2, this.reconnectAttempts - 1),
      this.retry.maxDelayMs
    );

    // Add jitter to prevent thundering herd problem
    const jitter = this.retry.jitterMs ? Math.floor(Math.random() * this.retry.jitterMs) : 0;

    const delay = baseDelay + jitter;

    this.emitter.emit('reconnecting', {
      attempt: this.reconnectAttempts,
      maxAttempts: this.retry.maxAttempts,
      delay,
    });

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connect();
      this.emitter.emit('reconnected');
    } catch (error) {
      if (this.reconnectAttempts < this.retry.maxAttempts) {
        // Try again
        return this.reconnect();
      } else {
        // Give up after max attempts
        const connectionError = new ConnectionError(
          error instanceof Error
            ? `Connection lost after ${this.retry.maxAttempts} reconnect attempts: ${error.message}`
            : `Connection lost after ${this.retry.maxAttempts} reconnect attempts`
        );

        this.emitter.emit('reconnectFailed', connectionError);
        this.cancelAllRequests(connectionError);
        throw connectionError;
      }
    }
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
      if (
        this.ws.readyState === WebSocketNode.OPEN ||
        this.ws.readyState === WebSocketNode.CONNECTING
      ) {
        this.ws.close();
      }

      this.ws = null;
    }

    // Clear connection promise
    this.connectionPromise = null;
  }

  /**
   * Clean up resources when instance is no longer needed
   */
  destroy(): void {
    this.cancelAllRequests(new ConnectionError('Client destroyed'));
    this.cleanup();

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.emitter.removeAllListeners();
    this.requestQueue = [];
  }

  /**
   * Cancel all pending requests with the given error
   */
  protected cancelAllRequests(error: Error): void {
    // Reject all pending messages
    for (const [id, request] of this.messageMap.entries()) {
      clearTimeout(request.timer);
      request.reject(error);
      this.messageMap.delete(id);
    }
  }

  /**
   * Remove stale requests that have been pending for too long
   */
  protected cleanupStaleRequests(): void {
    const now = Date.now();
    const staleThreshold = this.timeouts.OPERATION * 3; // 3x the operation timeout

    for (const [id, request] of this.messageMap.entries()) {
      const age = now - request.timestamp;

      if (age > staleThreshold) {
        clearTimeout(request.timer);
        request.reject(
          new TimeoutError(`Request ${id} (${request.operation}) timed out after ${age}ms`)
        );
        this.messageMap.delete(id);
      }
    }
  }

  /**
   * Handles disconnect events and attempts to reconnect
   */
  protected handleDisconnect(code?: number, reason?: string): void {
    if (this.connectionState === ConnectionState.DISCONNECTING) {
      this.connectionState = ConnectionState.DISCONNECTED;
      return;
    }

    if (this.reconnectAttempts < this.retry.maxAttempts) {
      this.reconnect().catch(() => {});
    } else {
      // Max reconnect attempts reached
      const connectionError = new ConnectionError(
        `Connection lost after ${this.retry.maxAttempts} reconnect attempts` +
          (code ? ` (code: ${code}${reason ? `, reason: ${reason}` : ''})` : '')
      );

      this.cancelAllRequests(connectionError);
    }
  }

  /**
   * Processes WebSocket messages and resolves corresponding promises
   * @param message - The message received from the WebSocket server
   */
  protected handleMessage(message: HPKVResponse): void {
    // Skip notification messages or messages without proper structure
    if (message.type !== undefined || message.messageId === undefined) {
      return;
    }

    const messageId = message.messageId;
    const pendingRequest = this.messageMap.get(messageId);

    if (!pendingRequest) {
      // This might happen if a request timed out but the server still responded
      return;
    }

    // Clean up the request
    clearTimeout(pendingRequest.timer);
    this.messageMap.delete(messageId);

    // Handle error responses
    if (message.success === false || message.code !== 200 || message.error) {
      pendingRequest.reject(
        new HPKVError(message.error || message.message || 'Unknown error', message.code)
      );
      return;
    }

    // Handle successful responses
    pendingRequest.resolve(message);
  }

  /**
   * Sends a message to the WebSocket server and handles the response
   * @param message - The message to send
   * @param timeoutMs - Optional custom timeout for this operation
   * @returns A promise that resolves with the server response
   * @throws Error if the message times out or connection fails
   */
  protected async sendMessage(
    message: Omit<HPKVRequestMessage, 'messageId'>,
    timeoutMs?: number
  ): Promise<HPKVResponse> {
    // If not connected and not currently connecting, trigger connect
    if (this.connectionState === ConnectionState.DISCONNECTED) {
      try {
        await this.connect();
      } catch (error) {
        return this.queueRequest(() => this.sendMessageInternal(message, timeoutMs));
      }
    }

    // If currently connecting, queue the request
    if (this.connectionState === ConnectionState.CONNECTING) {
      return this.queueRequest(() => this.sendMessageInternal(message, timeoutMs));
    }

    // Otherwise, send immediately
    return this.sendMessageInternal(message, timeoutMs);
  }

  /**
   * Internal implementation of message sending
   */
  private async sendMessageInternal(
    message: Omit<HPKVRequestMessage, 'messageId'>,
    timeoutMs?: number
  ): Promise<HPKVResponse> {
    // Ensure we're connected before proceeding
    if (
      this.connectionState !== ConnectionState.CONNECTED ||
      !this.ws ||
      this.ws.readyState !== WebSocketNode.OPEN
    ) {
      try {
        await this.connect();
      } catch (error) {
        throw new ConnectionError(
          `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      const messageWithId: HPKVRequestMessage = {
        ...message,
        messageId: id,
      };

      // Use custom timeout or default
      const actualTimeoutMs = timeoutMs || this.timeouts.OPERATION;

      // Set up message timeout
      const timer = setTimeout(() => {
        if (this.messageMap.has(id)) {
          this.messageMap.delete(id);
          reject(new TimeoutError(`Operation timed out after ${actualTimeoutMs}ms: ${message.op}`));
        }
      }, actualTimeoutMs);

      // Store the promise in the map
      this.messageMap.set(id, {
        resolve,
        reject,
        timer,
        timestamp: Date.now(),
        operation: message.op,
      });

      try {
        this.ws?.send(JSON.stringify(messageWithId));
      } catch (error) {
        clearTimeout(timer);
        this.messageMap.delete(id);
        reject(
          new ConnectionError(
            `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        );
      }
    });
  }

  /**
   * Processes the queued requests
   */
  private async processRequestQueue(): Promise<void> {
    // Make a copy to avoid issues if new requests are added during processing
    const queue = [...this.requestQueue];
    this.requestQueue = [];

    // Process each request serially to avoid overwhelming the connection
    for (const request of queue) {
      try {
        await request();
      } catch (error) {
        this.emitter.emit(
          'error',
          new Error(
            `Failed to process queued request: ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        );
      }

      // Small delay between requests to avoid flooding
      if (queue.length > 5) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }

  /**
   * Queue a request when connection is not available
   */
  private queueRequest<T>(request: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await request();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}
